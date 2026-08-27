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

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => unknown }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => count === 0 ? [] : [{ index: 0, key: getItemKey(0), size: 64, start: 0 }],
  }),
}))

const NOW = 1_800_000_000_000
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

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: NOW,
    ...overrides,
  }
}

function sessions(items: readonly SessionSummary[], overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function workspaces(sessionIds: SessionId[] = []): WorkspaceListState {
  return {
    items: sessionIds.length === 0
      ? []
      : [{
        workspaceId: WORKSPACE,
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
    recentWorkspaceId: sessionIds.length === 0 ? undefined : WORKSPACE,
  }
}

function mount({
  list,
  workspaceList = workspaces([...list.ids]),
  selected,
  open = true,
  cancelSession = vi.fn(async () => {}),
}: {
  list: SessionListState
  workspaceList?: WorkspaceListState
  selected?: SessionId
  open?: boolean
  cancelSession?: OverviewWorkbenchProps['cancelSession']
}) {
  const store = createSessionOverviewViewStore().create(`branch-${Math.random()}`)
  if (open) store.actions.setOpen(true)
  if (selected !== undefined) store.actions.selectSession(selected)
  const props: OverviewWorkbenchProps = {
    useSessions: selector => selector(list),
    useWorkspaces: selector => selector(workspaceList),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t,
    openSession: vi.fn(),
    cancelSession,
    archiveSession: vi.fn(async () => {}),
    respondInteraction: vi.fn(async () => {}),
    steerSession: vi.fn(async () => {}),
  }
  return { store, props, ...render(<OverviewWorkbench {...props} />) }
}

describe('OverviewWorkbench branch matrix', () => {
  it('renders pending and ready-empty states', () => {
    const pending = mount({ list: sessions([], { phase: 'pending' }) })
    expect(screen.getByText(zh['empty.pending'])).toBeDefined()
    pending.unmount()
    mount({ list: sessions([]) })
    expect(screen.getByText(zh['empty.ready'])).toBeDefined()
  })

  it('uses keyboard selection, renders unaccounted failed facts, and protects snooze', () => {
    const failed = summary('failed', {
      projectionValues: {
        sessionActivity: {
          lastMeaningfulSeq: null,
          lastMeaningfulAt: null,
          lastKind: 'turn',
          lastTurn: { turn: 1, seq: 1, endedAt: NOW, reason: 'error' },
          openTools: [],
          openToolsOmitted: 0,
        },
      },
    })
    mount({ list: sessions([failed]), workspaceList: workspaces([]) })
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!
    fireEvent.keyDown(row, { key: 'ArrowDown' })
    expect(screen.queryByText(zh['detail.noSelection'])).toBeNull()
    expect(screen.getByText(zh['context.freshnessUnavailable'])).toBeDefined()
    fireEvent.keyDown(row, { key: ' ' })
    expect(screen.getByText(zh['context.needsYou'])).toBeDefined()
    expect(screen.getByText(zh['reason.turn-error'])).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    expect(screen.getByRole('menuitem', { name: zh['action.snooze'] })).toHaveProperty('disabled', true)
    expect(screen.getByRole('menuitem', { name: zh['action.markViewed'] })).toHaveProperty('disabled', true)
  })

  it('drives attention, workspace, and pinned filters through their controls', () => {
    const item = summary('filter')
    const fixture = mount({ list: sessions([item]) })
    fireEvent.change(screen.getByRole('combobox', { name: zh['filter.attention'] }), { target: { value: 'idle' } })
    expect(fixture.store.getSnapshot().attention).toBe('idle')
    expect(screen.queryByRole('combobox', { name: zh['filter.workspace'] })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: zh['filter.pinnedOnly'] }))
    expect(fixture.store.getSnapshot().pinnedOnly).toBe(true)
  })

  it('renders the virtualized branch for large lists', () => {
    const items = Array.from({ length: 101 }, (_, index) => summary(`session-${String(index).padStart(3, '0')}`))
    mount({ list: sessions(items) })
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.textContent).toContain('session-000')
  })

  it('renders Goal, descendant, omitted-tool, and fresh-sequence details', () => {
    const parent = summary('parent', {
      projectionValues: {
        goal: {
          goal: {
            id: 'goal' as never,
            revision: 1,
            objective: 'Ship the release',
            phase: 'active',
            maxGoalRounds: 3,
          },
          roundsStarted: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        sessionActivity: {
          lastMeaningfulSeq: 7,
          lastMeaningfulAt: NOW,
          lastKind: 'tool',
          openTools: [],
          openToolsOmitted: 2,
        },
      },
    })
    const list = sessions([parent], {
      subagentsByParent: {
        [parent.id]: {
          state: 'ready', error: null, parentAvailable: true,
          entries: [{
            kind: 'child', id: 'child' as SessionId, mode: 'one-shot',
            activity: 'running', hasChildren: false,
          }],
        },
      },
    })
    mount({ list, selected: parent.id })
    expect(screen.getAllByText('Ship the release')).toHaveLength(2)
    expect(screen.getByText('1 个子 Agent 运行中')).toBeDefined()
    expect(screen.getByText('另有 2 个工具调用')).toBeDefined()
    expect(screen.getByText('覆盖到活动序号 7')).toBeDefined()
  })

  it('uses the generic failure copy for non-Error cancellation failures', async () => {
    const running = summary('running', { running: true })
    const cancelSession = vi.fn(async () => { throw 'rejected' })
    mount({ list: sessions([running]), cancelSession })
    fireEvent.click(within(screen.getByRole('table')).getByText('running'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['action.cancel'] }))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toBe(zh['action.failed'])
  })

  it('disables row actions while cancellation is unsettled', async () => {
    let settle!: () => void
    const cancelSession = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    const running = summary('running', { running: true })
    mount({ list: sessions([running]), cancelSession })
    fireEvent.click(within(screen.getByRole('table')).getByText('running'))
    fireEvent.click(screen.getByRole('button', { name: zh['action.cancel'] }))
    expect(screen.getByRole('button', { name: zh['action.cancel'] })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    expect(screen.getByRole('menuitem', { name: zh['action.archive'] })).toHaveProperty('disabled', true)
    await act(async () => { settle(); await Promise.resolve() })
  })
})
