/** Pure attention and row derivation for the DSH Beacon workbench. */

import type {
  SessionId,
  SessionListState,
  SessionSummary,
  PendingInteractionRequest,
  WorkspaceId,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-goal/client'
import type {} from '@deepseek-ai/dsh-session-activity/client'
import type {} from '@deepseek-ai/dsh-session-brief/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { SessionActivityProjection } from '@deepseek-ai/dsh-session-activity/client'
import type { SessionBriefEventData } from '@deepseek-ai/dsh-session-brief/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'

/** Primary attention classes in deterministic display precedence. */
export type OverviewAttentionState =
  | 'needs-action'
  | 'blocked'
  | 'failed'
  | 'running'
  | 'queued'
  | 'goal-complete'
  | 'changed'
  | 'paused'
  | 'idle'

/** Stable explanation for one row's primary attention class. */
export type OverviewAttentionReason =
  | 'approval'
  | 'question'
  | 'plan-review'
  | 'goal-blocked'
  | 'turn-blocked'
  | 'turn-error'
  | 'running'
  | 'descendant-running'
  | 'background-job'
  | 'goal-complete'
  | 'changed'
  | 'goal-paused'
  | 'idle'

/** Browser-owned review preferences for one Session. */
export interface SessionOverviewReview {
  pinned?: boolean
  snoozedUntil?: number
  bookmark?: string
  lastViewedSeq?: number
}

/** Browser-owned review preferences keyed by Session identity. */
export type SessionOverviewReviews = Readonly<Record<string, SessionOverviewReview>>

/** Todo counts retained separately from objective completion. */
export interface OverviewTodoProgress {
  total: number
  pending: number
  inProgress: number
  completed: number
}

/** Provenance class retained beside one deterministic context fact. */
export type OverviewContextProvenance = 'recorded' | 'agent-maintained' | 'user'

/** One bounded human-readable context fact and its authority class. */
export interface OverviewContextFact {
  text: string
  provenance: OverviewContextProvenance
}

/** Deterministic catch-up facts available without an auxiliary model request. */
export interface OverviewContextFacts {
  task: OverviewContextFact
  currentFocus?: OverviewContextFact
  completed: OverviewContextFact[]
  nextStep?: OverviewContextFact
  needsUserReason?: OverviewAttentionReason
}

/** One deterministic row consumed by the workbench presentation. */
export interface SessionOverviewRow {
  id: SessionId
  title: string
  cwd?: string
  agentPreset?: string
  workspaceId?: WorkspaceId
  workspaceTitle?: string
  attention: OverviewAttentionState
  reason: OverviewAttentionReason
  runningDescendants: number
  updatedAt: number
  lastMeaningfulAt: number
  lastMeaningfulSeq: number | null
  objective?: string
  goalPhase?: GoalProjection['goal']['phase']
  blockedReason?: string
  openTools: SessionActivityProjection['openTools']
  openToolsOmitted: number
  todo: OverviewTodoProgress | null
  context: OverviewContextFacts
  pendingInteraction?: PendingInteractionRequest
  brief?: SessionBriefEventData
  pinned: boolean
  snoozed: boolean
  bookmark?: string
}

/** Workbench filters applied after deterministic attention ordering. */
export interface SessionOverviewFilters {
  query: string
  attention: 'all' | OverviewAttentionState
  workspaceId: string | null
  pinnedOnly: boolean
}

const PRECEDENCE: Readonly<Record<OverviewAttentionState, number>> = {
  'needs-action': 1,
  blocked: 2,
  failed: 3,
  running: 4,
  queued: 5,
  'goal-complete': 6,
  changed: 7,
  paused: 8,
  idle: 9,
}

function todoProgress(todos: readonly TodoItem[] | null | undefined): OverviewTodoProgress | null {
  if (todos === undefined || todos === null) return null
  return {
    total: todos.length,
    pending: todos.filter(todo => todo.status === 'pending').length,
    inProgress: todos.filter(todo => todo.status === 'in_progress').length,
    completed: todos.filter(todo => todo.status === 'completed').length,
  }
}

function contextFacts({
  summary,
  goal,
  activity,
  todos,
  review,
  reason,
}: {
  summary: SessionSummary
  goal: GoalProjection | null | undefined
  activity: SessionActivityProjection | undefined
  todos: readonly TodoItem[] | null | undefined
  review: SessionOverviewReview
  reason: OverviewAttentionReason
}): OverviewContextFacts {
  const inProgress = todos?.find(todo => todo.status === 'in_progress')
  const nextTodo = todos?.find(todo => todo.status === 'pending')
  const openTools = activity?.openTools ?? []
  const completed = todos
    ?.filter(todo => todo.status === 'completed')
    .slice(-3)
    .map(todo => ({ text: todo.content, provenance: 'agent-maintained' as const })) ?? []
  const task: OverviewContextFact = goal === null || goal === undefined
    ? { text: summary.displayTitle, provenance: 'recorded' }
    : { text: goal.goal.objective, provenance: 'agent-maintained' }
  let currentFocus: OverviewContextFact | undefined
  if (goal?.goal.blockedReason !== undefined) {
    currentFocus = { text: goal.goal.blockedReason.message, provenance: 'agent-maintained' }
  } else if (inProgress !== undefined) {
    currentFocus = { text: inProgress.content, provenance: 'agent-maintained' }
  } else if (openTools.length > 0) {
    currentFocus = {
      text: openTools.map(tool => tool.name).join(', '),
      provenance: 'recorded',
    }
  }
  const nextStep: OverviewContextFact | undefined = nextTodo !== undefined
    ? { text: nextTodo.content, provenance: 'agent-maintained' }
    : review.bookmark === undefined
      ? undefined
      : { text: review.bookmark, provenance: 'user' }
  const needsUserReason = reason === 'approval'
    || reason === 'question'
    || reason === 'plan-review'
    || reason === 'goal-blocked'
    || reason === 'turn-blocked'
    || reason === 'turn-error'
    ? reason
    : undefined
  return {
    task,
    ...(currentFocus === undefined ? {} : { currentFocus }),
    completed,
    ...(nextStep === undefined ? {} : { nextStep }),
    ...(needsUserReason === undefined ? {} : { needsUserReason }),
  }
}

function runningDescendants(sessionId: SessionId, list: SessionListState): number {
  let count = 0
  const visited = new Set<SessionId>()
  const pending = [sessionId]
  while (pending.length > 0) {
    const parentId = pending.pop()
    if (parentId === undefined || visited.has(parentId)) continue
    visited.add(parentId)
    const catalog = list.subagentsByParent[parentId]
    if (catalog === undefined) continue
    for (const entry of catalog.entries) {
      if (entry.kind !== 'child') continue
      if (entry.activity === 'running') count += 1
      if (entry.hasChildren) pending.push(entry.id)
    }
  }
  return count
}

function attentionOf({
  summary,
  goal,
  activity,
  descendantCount,
  hasJobs,
  lastViewedSeq,
}: {
  summary: SessionSummary
  goal: GoalProjection | null | undefined
  activity: SessionActivityProjection | undefined
  descendantCount: number
  hasJobs: boolean
  lastViewedSeq: number | undefined
}): { attention: OverviewAttentionState; reason: OverviewAttentionReason } {
  if (summary.pendingInteraction !== undefined) {
    return { attention: 'needs-action', reason: summary.pendingInteraction }
  }
  if (goal?.goal.phase === 'blocked') return { attention: 'blocked', reason: 'goal-blocked' }
  if (activity?.lastTurn?.reason === 'blocked') return { attention: 'blocked', reason: 'turn-blocked' }
  if (activity?.lastTurn?.reason === 'error') return { attention: 'failed', reason: 'turn-error' }
  if (summary.running) return { attention: 'running', reason: 'running' }
  if (descendantCount > 0) return { attention: 'running', reason: 'descendant-running' }
  if (hasJobs) return { attention: 'queued', reason: 'background-job' }
  if (goal?.goal.phase === 'complete') return { attention: 'goal-complete', reason: 'goal-complete' }
  if (activity?.lastMeaningfulSeq !== null
    && activity?.lastMeaningfulSeq !== undefined
    && (lastViewedSeq === undefined || activity.lastMeaningfulSeq > lastViewedSeq)) {
    return { attention: 'changed', reason: 'changed' }
  }
  if (goal?.goal.phase === 'paused') return { attention: 'paused', reason: 'goal-paused' }
  return { attention: 'idle', reason: 'idle' }
}

/**
 * Derive visible top-level overview rows and their deterministic order.
 * @param list - current Session list and live Host mirrors.
 * @param workspaces - current Workspace accounts and archive set.
 * @param reviews - browser-local viewing state.
 * @param now - current epoch milliseconds used only for snooze expiry.
 * @returns attention-ordered overview rows.
 */
export function deriveOverviewRows(
  list: SessionListState,
  workspaces: WorkspaceListState,
  reviews: SessionOverviewReviews,
  now: number,
): SessionOverviewRow[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const workspaceBySession = new Map<SessionId, WorkspaceListState['items'][number]>()
  for (const workspace of workspaces.items) {
    for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace)
  }

  const rows: SessionOverviewRow[] = []
  for (const sessionId of list.ids) {
    const summary = list.byId[sessionId]
    if (summary === undefined || archived.has(sessionId)) continue
    if (summary.parentId !== undefined || summary.origin === 'subagent') continue

    const activity = summary.projectionValues?.sessionActivity
    const goal = summary.projectionValues?.goal
    const todos = summary.projectionValues?.todos
    const brief = summary.projectionValues?.sessionBrief
    const review = reviews[sessionId] ?? {}
    const descendantCount = runningDescendants(sessionId, list)
    const primary = attentionOf({
      summary,
      goal,
      activity,
      descendantCount,
      hasJobs: (list.jobsBySession[sessionId]?.length ?? 0) > 0,
      lastViewedSeq: review.lastViewedSeq,
    })
    const workspace = workspaceBySession.get(sessionId)
    const protectedAttention = primary.attention === 'needs-action' || primary.attention === 'failed'
    const snoozed = !protectedAttention
      && review.snoozedUntil !== undefined
      && review.snoozedUntil > now
    rows.push({
      id: sessionId,
      title: summary.displayTitle,
      ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
      ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }),
      ...(workspace === undefined
        ? {}
        : { workspaceId: workspace.workspaceId, workspaceTitle: workspace.title }),
      attention: primary.attention,
      reason: primary.reason,
      runningDescendants: descendantCount,
      updatedAt: summary.updatedAt,
      lastMeaningfulAt: activity?.lastMeaningfulAt ?? summary.updatedAt,
      lastMeaningfulSeq: activity?.lastMeaningfulSeq ?? null,
      ...(goal === null || goal === undefined
        ? {}
        : {
          objective: goal.goal.objective,
          goalPhase: goal.goal.phase,
          ...(goal.goal.blockedReason === undefined ? {} : { blockedReason: goal.goal.blockedReason.message }),
        }),
      openTools: activity?.openTools ?? [],
      openToolsOmitted: activity?.openToolsOmitted ?? 0,
      todo: todoProgress(todos),
      context: contextFacts({ summary, goal, activity, todos, review, reason: primary.reason }),
      ...(summary.pendingInteractionRequest === undefined
        ? {}
        : { pendingInteraction: summary.pendingInteractionRequest }),
      ...(brief === null || brief === undefined ? {} : { brief }),
      pinned: review.pinned === true,
      snoozed,
      ...(review.bookmark === undefined ? {} : { bookmark: review.bookmark }),
    })
  }

  rows.sort((left, right) => {
    const precedence = PRECEDENCE[left.attention] - PRECEDENCE[right.attention]
    if (precedence !== 0) return precedence
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    if (left.snoozed !== right.snoozed) return Number(left.snoozed) - Number(right.snoozed)
    if (left.lastMeaningfulAt !== right.lastMeaningfulAt) {
      return right.lastMeaningfulAt - left.lastMeaningfulAt
    }
    // SessionListState.ids is unique, so distinct rows cannot tie on id.
    return left.id < right.id ? -1 : 1
  })
  return rows
}

/**
 * Filter already-ordered rows without changing their relative order.
 * @param rows - attention-ordered overview rows.
 * @param filters - toolbar filter state.
 * @returns matching rows in the input order.
 */
export function filterOverviewRows(
  rows: readonly SessionOverviewRow[],
  filters: SessionOverviewFilters,
): SessionOverviewRow[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filters.attention !== 'all' && row.attention !== filters.attention) return false
    if (filters.workspaceId !== null && row.workspaceId !== filters.workspaceId) return false
    if (filters.pinnedOnly && !row.pinned) return false
    if (query === '') return true
    return [
      row.title,
      row.cwd,
      row.agentPreset,
      row.workspaceTitle,
      row.objective,
      row.blockedReason,
      row.bookmark,
      ...row.openTools.map(tool => tool.name),
    ].some(value => value?.toLocaleLowerCase().includes(query) === true)
  })
}
