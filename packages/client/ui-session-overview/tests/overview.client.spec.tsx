// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { OverviewWorkbench, type OverviewWorkbenchProps } from '../src/client/OverviewWorkbench.tsx'
import { createSessionOverviewViewStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'

const NOW = 1_800_000_000_000
const FIRST = 'first' as SessionId
const SECOND = 'second' as SessionId
const WORKSPACE = 'workspace' as WorkspaceId
const t: OverviewWorkbenchProps['t'] = makeTranslate(zh)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function summary(id: SessionId, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: NOW - 60_000,
    ...overrides,
  }
}

function sessionState(overrides: Partial<SessionListState> = {}): SessionListState {
  const first = summary(FIRST, {
    displayTitle: '等待批准的研究',
    pendingInteraction: 'approval',
    pendingInteractionRequest: {
      kind: 'approval', key: 'a:overview', status: 'approval',
      payload: { approvalId: 'overview' as never, toolName: 'terminal', reason: '需要写入工作区' },
    },
    projectionValues: {
      sessionActivity: {
        lastMeaningfulSeq: 12,
        lastMeaningfulAt: NOW - 120_000,
        lastKind: 'turn',
        openTools: [],
        openToolsOmitted: 0,
      },
    },
  })
  const second = summary(SECOND, {
    displayTitle: '正在构建',
    running: true,
    projectionValues: {
      sessionActivity: {
        lastMeaningfulSeq: 9,
        lastMeaningfulAt: NOW - 30_000,
        lastKind: 'tool',
        openTools: [{ callId: 'build', name: 'terminal', startedAt: NOW - 10_000 }],
        openToolsOmitted: 1,
      },
      todos: [{ content: 'Build', status: 'in_progress' }],
    },
  })
  return {
    ids: [SECOND, FIRST],
    byId: { [FIRST]: first, [SECOND]: second },
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function workspaceState(): WorkspaceListState {
  return {
    items: [{
      workspaceId: WORKSPACE,
      path: 'C:/work',
      title: '研究工作区',
      sessionIds: [FIRST, SECOND],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: WORKSPACE,
  }
}

function setup() {
  const store = createSessionOverviewViewStore().create('component')
  const sessions = sessionState()
  const workspaces = workspaceState()
  const openSession = vi.fn()
  const cancelSession = vi.fn(async () => {})
  const archiveSession = vi.fn(async () => {})
  const respondInteraction = vi.fn(async () => {})
  const steerSession = vi.fn(async () => {})
  const useSessions: OverviewWorkbenchProps['useSessions'] = selector => selector(sessions)
  const useWorkspaces: OverviewWorkbenchProps['useWorkspaces'] = selector => selector(workspaces)
  const shared = {
    useSessions,
    useWorkspaces,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t,
  }
  return {
    store,
    openSession,
    cancelSession,
    archiveSession,
    respondInteraction,
    steerSession,
    workbenchProps: {
      ...shared, openSession, cancelSession, archiveSession, respondInteraction, steerSession,
    } as OverviewWorkbenchProps,
  }
}

describe('DSH Beacon trigger and workbench', () => {
  it('shows realtime action and running Sessions without a numeric badge and opens the workbench', () => {
    const fixture = setup()
    const { container } = render(<OverviewWorkbench {...fixture.workbenchProps} />)
    expect(container.querySelector('[data-session-activity-beacon]')?.getAttribute('data-state')).toBe('needs-action')
    expect(container.querySelectorAll('[data-session-activity-beacon] [data-index]')).toHaveLength(1)
    expect(screen.getByText('等待批准的研究')).toBeDefined()
    expect(screen.getByText('正在构建')).toBeDefined()
    const trigger = screen.getByRole('button', { name: zh['beacon.aria.needsAction'] })
    expect(trigger.textContent).not.toMatch(/\d/)
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: zh.title })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['beacon.aria.needsAction'] }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('orders actionable work first and filters loaded row facts', () => {
    const fixture = setup()
    fixture.store.actions.setOpen(true)
    render(<OverviewWorkbench {...fixture.workbenchProps} />)
    const table = screen.getByRole('table', { name: zh.title })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('等待批准的研究')
    expect(rows[1]?.textContent).toContain('正在构建')
    fireEvent.change(screen.getByRole('searchbox', { name: zh['search.label'] }), {
      target: { value: 'terminal' },
    })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(table.textContent).toContain('正在构建')
    expect(table.textContent).not.toContain('等待批准的研究')
  })

  it('selects a row and routes review, open, cancel, archive, pin, and snooze actions', async () => {
    const fixture = setup()
    fixture.store.actions.setOpen(true)
    render(<OverviewWorkbench {...fixture.workbenchProps} />)
    fireEvent.click(screen.getByText('正在构建'))
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh['action.markViewed'] }))
    expect(fixture.store.getSnapshot().reviews[SECOND]?.lastViewedSeq).toBe(9)

    fireEvent.change(screen.getByPlaceholderText(zh['detail.bookmarkPlaceholder']), {
      target: { value: '检查构建日志' },
    })
    expect(fixture.store.getSnapshot().reviews[SECOND]?.bookmark).toBe('检查构建日志')

    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh['action.pin'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh['action.snooze'] }))
    expect(fixture.store.getSnapshot().reviews[SECOND]).toMatchObject({ pinned: true, snoozedUntil: NOW + 3_600_000 })
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    expect(screen.getByRole('menuitem', { name: zh['action.unpin'] })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: zh['action.unsnooze'] }))
    expect(fixture.store.getSnapshot().reviews[SECOND]?.snoozedUntil).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh['action.snooze'] }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['action.cancel'] }))
      await Promise.resolve()
    })
    expect(fixture.cancelSession).toHaveBeenCalledWith(SECOND)
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: zh['action.archive'] }))
      await Promise.resolve()
    })
    expect(fixture.archiveSession).toHaveBeenCalledWith(SECOND)
    fireEvent.click(screen.getByRole('button', { name: zh['action.open'] }))
    expect(fixture.openSession).toHaveBeenCalledWith(SECOND)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('surfaces action failures without hiding the last valid rows', async () => {
    const fixture = setup()
    fixture.cancelSession.mockRejectedValueOnce(new Error('cancel rejected'))
    fixture.store.actions.setOpen(true)
    render(<OverviewWorkbench {...fixture.workbenchProps} />)
    fireEvent.click(screen.getByText('正在构建'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['action.cancel'] }))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toContain('cancel rejected')
    expect(screen.getByRole('table').textContent).toContain('正在构建')
  })

  it('routes selected interaction decisions and steering through injected callbacks', async () => {
    const fixture = setup()
    fixture.store.actions.setOpen(true)
    render(<OverviewWorkbench {...fixture.workbenchProps} />)
    expect(screen.getByText('需要写入工作区')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['interaction.reject'] }))
      await Promise.resolve()
    })
    expect(fixture.respondInteraction).toHaveBeenCalledWith(FIRST, 'a:overview', {
      kind: 'approval', outcome: 'rejected',
    })

    fireEvent.click(screen.getByText('正在构建'))
    const steer = screen.getByPlaceholderText(zh['steer.placeholder'])
    fireEvent.change(steer, { target: { value: '检查构建日志' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['steer.send'] }))
      await Promise.resolve()
    })
    expect(fixture.steerSession).toHaveBeenCalledWith(SECOND, '检查构建日志')
  })

  it('reports interaction failures without replacing Session details', async () => {
    const fixture = setup()
    fixture.respondInteraction.mockRejectedValueOnce(new Error('approval already resolved'))
    fixture.store.actions.setOpen(true)
    render(<OverviewWorkbench {...fixture.workbenchProps} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['interaction.allowOnce'] }))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toContain('approval already resolved')
    expect(screen.getByRole('table').textContent).toContain('等待批准的研究')
  })
})
