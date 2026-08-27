// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ContextView, type ContextViewProps } from '../src/client/ContextView.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId
const WORKSPACE = 'workspace' as WorkspaceId
const t: ContextViewProps['t'] = makeTranslate(zh)

afterEach(cleanup)

function props(
  present = true,
  refreshBrief: ContextViewProps['refreshBrief'] = vi.fn(async () => {}),
): ContextViewProps {
  const sessions: SessionListState = {
    ids: present ? [SESSION] : [],
    byId: present
      ? {
        [SESSION]: {
          id: SESSION,
          displayTitle: 'Context implementation',
          running: true,
          blank: false,
          updatedAt: 100,
          projectionValues: {
            goal: {
              goal: {
                id: 'goal' as never,
                revision: 1,
                objective: 'Reduce context switching cost',
                phase: 'active',
                maxGoalRounds: 5,
              },
              roundsStarted: 2,
              createdAt: 1,
              updatedAt: 2,
            },
            todos: [
              { content: 'Derive facts', status: 'completed' },
              { content: 'Render Context tab', status: 'in_progress' },
              { content: 'Run browser replay', status: 'pending' },
            ],
            sessionActivity: {
              lastMeaningfulSeq: 21,
              lastMeaningfulAt: 90,
              lastKind: 'todo',
              openTools: [{ callId: 'call', name: 'terminal', startedAt: 80 }],
              openToolsOmitted: 0,
            },
            sessionBrief: {
              version: 1,
              revision: 1,
              sourceSeq: 20,
              generatedAt: 85,
              task: 'Summarize the Session context',
              currentGoal: 'Finish Context Brief integration',
              currentFocus: 'Connect generated context',
              completed: ['Built the brief service'],
              nextStep: 'Refresh the browser snapshot',
              blockers: ['Awaiting provider evaluation'],
              waitingForUser: 'Review the generated interpretation',
              provenance: {
                provider: 'brief-route',
                model: 'brief-model',
                sourceEventSeqs: [20],
              },
            },
          },
        },
      }
      : {},
    current: present ? SESSION : undefined,
    phase: 'ready',
    subagentsByParent: present
      ? {
        [SESSION]: {
          state: 'ready',
          error: null,
          parentAvailable: true,
          entries: [{
            kind: 'child',
            id: 'child' as SessionId,
            mode: 'one-shot',
            activity: 'running',
            hasChildren: false,
          }],
        },
      }
      : {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaces: WorkspaceListState = {
    items: present
      ? [{
        workspaceId: WORKSPACE,
        path: 'C:/work',
        title: 'Harness',
        sessionIds: [SESSION],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }]
      : [],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: present ? WORKSPACE : undefined,
  }
  const useSessions: ContextViewProps['useSessions'] = selector => selector(sessions)
  const useWorkspaces: ContextViewProps['useWorkspaces'] = selector => selector(workspaces)
  return {
    sessionId: SESSION,
    useSessions,
    useWorkspaces,
    refreshBrief,
    t,
  } as unknown as ContextViewProps
}

describe('ContextView', () => {
  it('renders the current Session context and operational metadata', () => {
    render(<ContextView {...props()} />)
    for (const text of [
      zh['catchup.title'],
      'Context implementation',
      zh['status.running'],
      '工作区：Harness',
      'Todo 1/3',
      '1 个子 Agent 运行中',
      '活跃工具：terminal',
      'Reduce context switching cost',
      'Render Context tab',
      'Derive facts',
      'Run browser replay',
      '覆盖到活动序号 21',
      zh['context.generated'],
      'brief-route / brief-model',
      'Summarize the Session context',
      'Finish Context Brief integration',
      'Connect generated context',
      'Built the brief service',
      'Refresh the browser snapshot',
      'Awaiting provider evaluation',
      'Review the generated interpretation',
      '解读已过期：覆盖到 20，最新活动为 21',
    ]) expect(screen.getByText(text)).toBeDefined()
  })

  it('renders an explicit unavailable state for a missing Session', () => {
    render(<ContextView {...props(false)} />)
    expect(screen.getByText(zh['catchup.unavailable'])).toBeDefined()
  })

  it('dispatches explicit brief refresh and reports admission failure', async () => {
    let resolveRefresh!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    const rendered = render(<ContextView {...props(true, refresh)} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.refreshBrief'] }))
    await waitFor(() => { expect(refresh).toHaveBeenCalledWith(SESSION) })
    expect(screen.getByRole('button', { name: zh['action.refreshBrief'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(zh['action.refreshBriefRunning'])
    resolveRefresh()
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(zh['action.refreshBriefSucceeded'])
    })

    rendered.unmount()
    const failed = vi.fn(async () => { throw new Error('unavailable') })
    render(<ContextView {...props(true, failed)} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.refreshBrief'] }))
    expect((await screen.findByRole('alert')).textContent).toBe('unavailable')

    cleanup()
    const malformed = vi.fn(() => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise arbitrary transport rejection containment
      return Promise.reject(null)
    })
    render(<ContextView {...props(true, malformed)} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.refreshBrief'] }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh['action.refreshBriefFailed'])
  })
})
