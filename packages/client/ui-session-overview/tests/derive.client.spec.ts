import { describe, expect, it } from 'vitest'
import type {
  SessionId,
  SessionListState,
  SessionSummary,
  WorkspaceId,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { SessionActivityProjection } from '@deepseek-ai/dsh-session-activity/client'
import {
  deriveOverviewRows,
  filterOverviewRows,
  type SessionOverviewReviews,
} from '../src/client/derive.ts'

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

function activity(overrides: Partial<SessionActivityProjection> = {}): SessionActivityProjection {
  return {
    lastMeaningfulSeq: null,
    lastMeaningfulAt: null,
    lastKind: null,
    openTools: [],
    openToolsOmitted: 0,
    ...overrides,
  }
}

function goal(phase: GoalProjection['goal']['phase']): GoalProjection {
  return {
    goal: {
      id: 'goal' as GoalProjection['goal']['id'],
      revision: 1,
      objective: `objective-${phase}`,
      phase,
      ...(phase === 'blocked' ? { blockedReason: { code: 'blocked', message: 'Needs a decision' } } : {}),
      maxGoalRounds: 3,
    },
    roundsStarted: 1,
    createdAt: 1,
    updatedAt: 2,
  }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 100,
    ...overrides,
  }
}

function fixture(
  summaries: readonly SessionSummary[],
  overrides: Partial<SessionListState> = {},
): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function workspaceState(sessionIds: SessionId[] = []): WorkspaceListState {
  return {
    items: [{
      workspaceId: wid('workspace'),
      path: 'C:/work',
      title: 'Work',
      sessionIds,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: wid('workspace'),
  }
}

function derive(summaries: readonly SessionSummary[], reviews: SessionOverviewReviews = {}) {
  const sessions = fixture(summaries)
  return deriveOverviewRows(sessions, workspaceState([...sessions.ids]), reviews, 1_000)
}

describe('deriveOverviewRows attention semantics', () => {
  it('orders every primary state by explicit precedence', () => {
    const rows = derive([
      summary('idle'),
      summary('paused', { projectionValues: { goal: goal('paused') } }),
      summary('changed', { projectionValues: { sessionActivity: activity({ lastMeaningfulSeq: 4 }) } }),
      summary('complete', { projectionValues: { goal: goal('complete') } }),
      summary('queued'),
      summary('running', { running: true }),
      summary('failed', {
        projectionValues: { sessionActivity: activity({
          lastTurn: { turn: 1, seq: 2, endedAt: 3, reason: 'error', errorCode: 'MODEL' },
        }) },
      }),
      summary('blocked', { projectionValues: { goal: goal('blocked') } }),
      summary('action', { pendingInteraction: 'approval' }),
    ])
    const withJobs = fixture(rows.map(row => summary(row.id)), { jobsBySession: { [sid('queued')]: [{ id: 'job' }] as never } })
    const source = fixture([
      summary('idle'),
      summary('paused', { projectionValues: { goal: goal('paused') } }),
      summary('changed', { projectionValues: { sessionActivity: activity({ lastMeaningfulSeq: 4 }) } }),
      summary('complete', { projectionValues: { goal: goal('complete') } }),
      summary('queued'),
      summary('running', { running: true }),
      summary('failed', { projectionValues: { sessionActivity: activity({
        lastTurn: { turn: 1, seq: 2, endedAt: 3, reason: 'error' },
      }) } }),
      summary('blocked', { projectionValues: { goal: goal('blocked') } }),
      summary('action', {
        pendingInteraction: 'approval',
        pendingInteractionRequest: {
          kind: 'approval', key: 'a:action', status: 'approval',
          payload: { approvalId: 'action' as never, toolName: 'terminal' },
        },
      }),
    ], { jobsBySession: withJobs.jobsBySession })
    const derived = deriveOverviewRows(source, workspaceState([...source.ids]), {}, 1_000)
    expect(derived.map(row => row.attention)).toEqual([
      'needs-action', 'blocked', 'failed', 'running', 'queued',
      'goal-complete', 'changed', 'paused', 'idle',
    ])
    expect(derived[0]?.pendingInteraction?.key).toBe('a:action')
  })

  it('keeps turn completion and completed Todos separate from objective completion', () => {
    const [row] = derive([summary('work', { projectionValues: {
      sessionActivity: activity({
        lastMeaningfulSeq: 8,
        lastTurn: { turn: 1, seq: 8, endedAt: 80, reason: 'completed' },
      }),
      todos: [{ content: 'Done', status: 'completed' }],
    } })], { work: { lastViewedSeq: 8 } })
    expect(row).toMatchObject({
      attention: 'idle',
      reason: 'idle',
      todo: { total: 1, pending: 0, inProgress: 0, completed: 1 },
    })
  })

  it('lets pin and snooze reorder only within one class and never snoozes mandatory attention', () => {
    const rows = derive([
      summary('fresh', { updatedAt: 300 }),
      summary('pinned', { updatedAt: 100 }),
      summary('snoozed', { updatedAt: 400 }),
      summary('approval', { pendingInteraction: 'question', updatedAt: 1 }),
    ], {
      pinned: { pinned: true },
      snoozed: { snoozedUntil: 2_000 },
      approval: { snoozedUntil: 2_000 },
    })
    expect(rows.map(row => row.id)).toEqual(['approval', 'pinned', 'fresh', 'snoozed'])
    expect(rows[0]).toMatchObject({ attention: 'needs-action', snoozed: false })
  })

  it('counts uninterrupted running descendants recursively and tolerates catalog cycles', () => {
    const parent = summary('parent')
    const sessions = fixture([parent], {
      subagentsByParent: {
        [sid('parent')]: {
          state: 'ready', error: null, parentAvailable: true,
          entries: [{ kind: 'child', id: sid('child'), mode: 'continuable', label: 'Child', activity: 'running', hasChildren: true }],
        },
        [sid('child')]: {
          state: 'ready', error: null, parentAvailable: true,
          entries: [{ kind: 'child', id: sid('parent'), mode: 'one-shot', activity: 'inactive', hasChildren: true }],
        },
      },
    })
    expect(deriveOverviewRows(sessions, workspaceState([sid('parent')]), {}, 1_000)[0]).toMatchObject({
      attention: 'running',
      reason: 'descendant-running',
      runningDescendants: 1,
    })
  })

  it('excludes archived and subagent rows and composes workspace, Goal, activity, and bookmark facts', () => {
    const top = summary('top', {
      cwd: 'C:/work',
      agentPreset: 'coding',
      projectionValues: {
        goal: goal('active'),
        sessionActivity: activity({
          lastMeaningfulSeq: 9,
          lastMeaningfulAt: 90,
          lastKind: 'tool',
          openTools: [{ callId: 'call', name: 'read', startedAt: 80 }],
          openToolsOmitted: 2,
        }),
        todos: null,
      },
    })
    const child = summary('child', { origin: 'subagent', parentId: sid('top') })
    const archived = summary('archived')
    const sessions = fixture([top, child, archived])
    const workspaces = workspaceState([top.id, child.id, archived.id])
    workspaces.archivedSessionIds = [archived.id]
    expect(deriveOverviewRows(sessions, workspaces, { top: { bookmark: 'Review diff' } }, 1_000)).toEqual([
      expect.objectContaining({
        id: top.id,
        workspaceTitle: 'Work',
        objective: 'objective-active',
        openTools: [{ callId: 'call', name: 'read', startedAt: 80 }],
        openToolsOmitted: 2,
        bookmark: 'Review diff',
      }),
    ])
  })

  it('filters ordered rows by state, workspace, pin, and loaded searchable facts', () => {
    const rows = derive([
      summary('alpha', {
        projectionValues: { sessionActivity: activity({
          lastMeaningfulSeq: 2,
          openTools: [{ callId: 'call', name: 'search', startedAt: 20 }],
        }) },
      }),
      summary('beta', { pendingInteraction: 'question' }),
    ], { alpha: { pinned: true, bookmark: 'Review evidence' } })
    expect(filterOverviewRows(rows, {
      query: 'EVIDENCE', attention: 'changed', workspaceId: 'workspace', pinnedOnly: true,
    }).map(row => row.id)).toEqual(['alpha'])
    expect(filterOverviewRows(rows, {
      query: 'search', attention: 'all', workspaceId: null, pinnedOnly: false,
    }).map(row => row.id)).toEqual(['alpha'])
    expect(filterOverviewRows(rows, {
      query: '', attention: 'idle', workspaceId: null, pinnedOnly: false,
    })).toEqual([])
    expect(filterOverviewRows(rows, {
      query: '', attention: 'all', workspaceId: 'other', pinnedOnly: false,
    })).toEqual([])
    expect(filterOverviewRows(rows, {
      query: '', attention: 'all', workspaceId: null, pinnedOnly: true,
    }).map(row => row.id)).toEqual(['alpha'])
    expect(filterOverviewRows(rows, {
      query: 'missing', attention: 'all', workspaceId: null, pinnedOnly: false,
    })).toEqual([])
  })

  it('handles incomplete list mirrors and every top-level exclusion arm', () => {
    const parentOnly = summary('parent-only', { parentId: sid('root') })
    const originOnly = summary('origin-only', { origin: 'subagent' })
    const top = summary('top', { projectionValues: { sessionActivity: activity() } })
    const sessions = fixture([parentOnly, originOnly, top])
    sessions.ids = [sid('missing'), ...sessions.ids]
    const rows = deriveOverviewRows(sessions, workspaceState([]), {}, 1_000)
    expect(rows.map(row => row.id)).toEqual([top.id])
    expect('workspaceId' in rows[0]!).toBe(false)
  })

  it('uses Turn blockers and traverses diagnostic, inactive, and leaf catalog entries', () => {
    const parent = summary('parent', { projectionValues: { sessionActivity: activity({
      lastTurn: { turn: 1, seq: 1, endedAt: 10, reason: 'blocked' },
    }) } })
    const sessions = fixture([parent], {
      subagentsByParent: {
        [parent.id]: {
          state: 'ready', error: null, parentAvailable: true,
          entries: [
            { kind: 'diagnostic', id: sid('bad'), reason: 'corrupt' },
            { kind: 'child', id: sid('inactive'), mode: 'one-shot', activity: 'inactive', hasChildren: false },
          ],
        },
      },
    })
    expect(deriveOverviewRows(sessions, workspaceState([]), {}, 1_000)[0]).toMatchObject({
      attention: 'blocked', reason: 'turn-blocked', runningDescendants: 0,
    })
  })

  it('orders equal-class rows by recency and then stable Session id', () => {
    const rows = derive([
      summary('same-b', { updatedAt: 50 }),
      summary('newest', { updatedAt: 100 }),
      summary('same-a', { updatedAt: 50 }),
    ])
    expect(rows.map(row => row.id)).toEqual(['newest', 'same-a', 'same-b'])
  })

  it('derives provenance-labeled context from Goal, Todo, blocker, and review facts', () => {
    const rows = derive([
      summary('goal-context', {
        projectionValues: {
          goal: goal('active'),
          todos: [
            { content: 'Finished research', status: 'completed' },
            { content: 'Implement context card', status: 'in_progress' },
            { content: 'Run browser checks', status: 'pending' },
          ],
        },
      }),
      summary('title-context'),
      summary('blocked-context', { projectionValues: { goal: goal('blocked') } }),
      summary('tool-context', { projectionValues: { sessionActivity: activity({
        openTools: [{ callId: 'call', name: 'terminal', startedAt: 1 }],
      }) } }),
    ], { 'title-context': { bookmark: 'Inspect latest answer' } })
    expect(rows.find(row => row.id === 'goal-context')?.context).toEqual({
      task: { text: 'objective-active', provenance: 'agent-maintained' },
      currentFocus: { text: 'Implement context card', provenance: 'agent-maintained' },
      completed: [{ text: 'Finished research', provenance: 'agent-maintained' }],
      nextStep: { text: 'Run browser checks', provenance: 'agent-maintained' },
    })
    expect(rows.find(row => row.id === 'title-context')?.context).toEqual({
      task: { text: 'title-context', provenance: 'recorded' },
      completed: [],
      nextStep: { text: 'Inspect latest answer', provenance: 'user' },
    })
    expect(rows.find(row => row.id === 'blocked-context')?.context).toMatchObject({
      currentFocus: { text: 'Needs a decision', provenance: 'agent-maintained' },
      needsUserReason: 'goal-blocked',
    })
    expect(rows.find(row => row.id === 'tool-context')?.context.currentFocus).toEqual({
      text: 'terminal', provenance: 'recorded',
    })
  })
})
