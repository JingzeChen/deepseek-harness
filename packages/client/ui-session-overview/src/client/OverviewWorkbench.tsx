/** Global attention-ordered Session workbench. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import {
  Button,
  IconArchiveOutline20,
  IconCheckOutline16,
  IconChevronLeftOutline14,
  IconCloseOutline16,
  IconEllipsisOutline16,
  IconFolderOpenOutline16,
  IconPauseOutline16,
  IconPersonalizationOutline16,
  IconPlayOutline16,
  IconStopFill16,
  IconWarningOutline16,
  Menu,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { QuestionResponsePayload } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  deriveOverviewRows, filterOverviewRows,
  type OverviewAttentionState, type SessionOverviewRow,
} from './derive.ts'
import { activityText, focusText } from './presentation.ts'
import { OverviewActivityBeacon } from './OverviewActivityBeacon.tsx'
import { ContextSummary } from './ContextSummary.tsx'
import { InteractionPanel, SteerControl } from './InteractionPanel.tsx'
import type { createSessionOverviewViewStore } from './stores.ts'
import type {} from './locales.ts'
import css from './OverviewWorkbench.module.css'

/** Service callbacks narrowed for the overview presentation. */
export interface OverviewWorkbenchInjected {
  openSession: (sessionId: SessionId) => void
  cancelSession: (sessionId: SessionId) => Promise<void>
  archiveSession: (sessionId: SessionId) => Promise<void>
  respondInteraction: (
    sessionId: SessionId,
    key: string,
    response: OverviewInteractionResponse,
  ) => Promise<void>
  steerSession: (sessionId: SessionId, text: string) => Promise<void>
}

/** User decision routed to the current PendingWait for one Session. */
export type OverviewInteractionResponse =
  | { kind: 'approval'; outcome: 'allowed-once' | 'rejected' }
  | { kind: 'question'; answer: QuestionResponsePayload['answer'] }
  | { kind: 'question-cancel' }

/** Workbench props derived from the shell slot, store, locale, and inject face. */
export type OverviewWorkbenchProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createSessionOverviewViewStore>>
  & PropsLocale<'sessionOverview'>
  & OverviewWorkbenchInjected

const ATTENTION_FILTERS: readonly OverviewAttentionState[] = [
  'needs-action', 'blocked', 'failed', 'running', 'queued',
  'goal-complete', 'changed', 'paused', 'idle',
]
const ROW_HEIGHT = 64
const VIRTUALIZE_AT = 100

function report(operation: Promise<void>): void {
  void operation.catch(() => {})
}

function OverviewRow({
  row, selected, now, showWorkspace, onSelect, t,
}: {
  row: SessionOverviewRow
  selected: boolean
  now: number
  showWorkspace: boolean
  onSelect: () => void
  t: OverviewWorkbenchProps['t']
}) {
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      className={clsx(css.row, showWorkspace && css.withWorkspace, selected && css.selected)}
      data-attention={row.attention}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div role="cell" className={css.sessionCell}>
        <strong>{row.title}</strong>
      </div>
      <div role="cell" className={css.statusFocus}>
        <span className={css.status}>
          <StatusIcon attention={row.attention} />
          {t(`status.${row.attention}`)}
        </span>
        <span className={css.ellipsis}>{focusText(row, t)}</span>
      </div>
      <div role="cell" className={css.activity}>{activityText(row.updatedAt, now, t)}</div>
      {showWorkspace && <div role="cell" className={css.ellipsis}>{row.workspaceTitle ?? '—'}</div>}
    </div>
  )
}

function StatusIcon({ attention }: { attention: OverviewAttentionState }) {
  switch (attention) {
    case 'needs-action':
    case 'blocked':
    case 'failed':
      return <IconWarningOutline16 />
    case 'running':
    case 'queued':
      return <IconPlayOutline16 />
    case 'goal-complete':
    case 'changed':
      return <IconCheckOutline16 />
    case 'paused':
    case 'idle':
      return <IconPauseOutline16 />
  }
  const unreachable: never = attention
  return unreachable
}

/** Render the modal workbench from global object-layer snapshots. */
export function OverviewWorkbench({
  useSessions, useWorkspaces, useStore, actions, t,
  openSession, cancelSession, archiveSession, respondInteraction, steerSession,
}: OverviewWorkbenchProps) {
  const view = useStore(state => state)
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const [busySessionId, setBusySessionId] = useState<SessionId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [detailMenuOpen, setDetailMenuOpen] = useState(false)
  const now = Date.now()
  const rows = useMemo(
    () => deriveOverviewRows(sessions, workspaces, view.reviews, now),
    [now, sessions, view.reviews, workspaces],
  )
  const filtered = useMemo(
    () => filterOverviewRows(rows, {
      query: view.query,
      attention: view.attention,
      workspaceId: view.workspaceId,
      pinnedOnly: view.pinnedOnly,
    }),
    [rows, view.attention, view.pinnedOnly, view.query, view.workspaceId],
  )
  const selected = filtered.find(row => row.id === view.selectedSessionId)
    ?? filtered.find(row => row.id === sessions.current)
    ?? filtered[0]
  const showWorkspace = workspaces.items.length > 1
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => {
      const row = filtered[index]
      /* v8 ignore next -- the virtualizer emits indexes strictly below the supplied count. */
      return row === undefined ? index : row.id
    },
  })
  const virtualized = filtered.length >= VIRTUALIZE_AT

  useEffect(() => {
    actions.retainSessions(sessions.ids, Date.now())
  }, [actions, sessions.ids])

  const run = async (sessionId: SessionId, operation: () => Promise<void>): Promise<void> => {
    setBusySessionId(sessionId)
    setError(null)
    try {
      await operation()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('action.failed'))
      throw cause
    } finally {
      setBusySessionId(null)
    }
  }

  const renderRow = (row: SessionOverviewRow) => (
    <OverviewRow
      key={row.id}
      row={row}
      selected={row.id === selected?.id}
      now={now}
      showWorkspace={showWorkspace}
      onSelect={() => {
        actions.selectSession(row.id)
        setMobileDetailOpen(true)
      }}
      t={t}
    />
  )

  const closeWorkbench = () => {
    setMobileDetailOpen(false)
    setMobileFilterOpen(false)
    setDetailMenuOpen(false)
    actions.setOpen(false)
  }

  return (
    <>
      {!view.open && (
        <OverviewActivityBeacon
          rows={rows}
          position={view.beaconPosition}
          onPositionChange={actions.setBeaconPosition}
          onOpen={() => { actions.setOpen(true) }}
          t={t}
        />
      )}
      <Modal
        open={view.open}
        onClose={closeWorkbench}
        title={t('title')}
        closeLabel={t('close')}
        className={css.dialog as string}
        headless
      >
        <div className={css.modalShell} data-mobile-detail={mobileDetailOpen || undefined}>
          <header className={css.modalHeader}>
            <div>
              <h2>{t('title')}</h2>
              <p>{t('summary.count', { visible: filtered.length, total: rows.length })}</p>
            </div>
            <button type="button" onClick={closeWorkbench} aria-label={t('close')}>
              <IconCloseOutline16 />
            </button>
          </header>

          <div className={css.toolbar} data-workspaces={showWorkspace || undefined}>
            <input
              type="search"
              value={view.query}
              maxLength={200}
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              onChange={(event) => { actions.setQuery(event.currentTarget.value) }}
            />
            <select
              className={css.desktopAttentionFilter}
              aria-label={t('filter.attention')}
              value={view.attention}
              onChange={(event) => { actions.setAttention(event.currentTarget.value as typeof view.attention) }}
            >
              <option value="all">{t('filter.all')}</option>
              {ATTENTION_FILTERS.map(attention => (
                <option key={attention} value={attention}>{t(`status.${attention}`)}</option>
              ))}
            </select>
            {showWorkspace && (
              <select
                className={css.desktopWorkspaceFilter}
                aria-label={t('filter.workspace')}
                value={view.workspaceId ?? ''}
                onChange={(event) => { actions.setWorkspaceId(event.currentTarget.value || null) }}
              >
                <option value="">{t('filter.allWorkspaces')}</option>
                {workspaces.items.map(workspace => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
                ))}
              </select>
            )}
            <label className={clsx(css.checkbox, css.desktopPinnedFilter)}>
              <input
                type="checkbox"
                checked={view.pinnedOnly}
                onChange={(event) => { actions.setPinnedOnly(event.currentTarget.checked) }}
              />
              {t('filter.pinnedOnly')}
            </label>
            <span className={css.mobileFilter}>
              <Menu
                open={mobileFilterOpen}
                onClose={() => { setMobileFilterOpen(false) }}
                items={[
                  { id: 'all', label: t('filter.all') },
                  ...ATTENTION_FILTERS.map(attention => ({
                    id: attention,
                    label: t(`status.${attention}`),
                  })),
                ]}
                selectedId={view.attention}
                onSelect={(attention) => {
                  actions.setAttention(attention as typeof view.attention)
                  setMobileFilterOpen(false)
                }}
                align="end"
                portal
                compact
                anchor={(
                  <button
                    type="button"
                    className={css.mobileFilterButton}
                    aria-label={t('filter.mobile')}
                    onClick={() => { setMobileFilterOpen(open => !open) }}
                  >
                    <IconPersonalizationOutline16 />
                    <span>{t('filter.mobile')}</span>
                  </button>
                )}
              />
            </span>
          </div>

          {error !== null && (
            <div className={css.resultMeta} aria-live="polite">
              <span role="alert" className={css.error}>{error}</span>
            </div>
          )}

          <div className={css.workbench} data-mobile-detail={mobileDetailOpen || undefined}>
            <div className={css.table} role="table" aria-label={t('title')}>
              <div className={clsx(css.header, showWorkspace && css.withWorkspace)} role="row">
                <span role="columnheader">{t('column.session')}</span>
                <span role="columnheader">{t('column.focus')}</span>
                <span role="columnheader">{t('column.activity')}</span>
                {showWorkspace && <span role="columnheader">{t('column.workspace')}</span>}
              </div>
              <div ref={scrollRef} className={css.rows} role="rowgroup">
                {sessions.phase !== 'ready'
                  ? <div className={css.empty}>{t('empty.pending')}</div>
                  : filtered.length === 0
                    ? <div className={css.empty}>{t('empty.ready')}</div>
                    : virtualized
                      ? (
                        <div className={css.virtualSpace} style={{ height: virtualizer.getTotalSize() }}>
                          {virtualizer.getVirtualItems().map((item) => {
                            const row = filtered[item.index]
                            /* v8 ignore next -- `item.index` is bounded by the virtualizer count above. */
                            if (row === undefined) return null
                            return (
                              <div
                                key={item.key}
                                className={css.virtualRow}
                                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                              >
                                {renderRow(row)}
                              </div>
                            )
                          })}
                        </div>
                      )
                      : filtered.map(renderRow)}
              </div>
            </div>

            <aside className={css.details} aria-label={t('detail.title')}>
              <div className={css.detailHeader}>
                <button
                  type="button"
                  className={css.mobileBack}
                  onClick={() => { setMobileDetailOpen(false) }}
                  aria-label={t('detail.back')}
                >
                  <IconChevronLeftOutline14 />
                  <span>{t('detail.back')}</span>
                </button>
                <h3>{selected?.title ?? t('detail.title')}</h3>
              </div>
              {selected === undefined
                ? <p className={css.muted}>{t('detail.noSelection')}</p>
                : (
                  <>
                    <ContextSummary
                      facts={selected.context}
                      reason={selected.reason}
                      lastMeaningfulSeq={selected.lastMeaningfulSeq}
                      brief={selected.brief}
                      collapseSecondary
                      t={t}
                    />
                    {selected.runningDescendants > 0 && (
                      <p className={css.secondaryFact}>
                        {t('descendants.running', { count: selected.runningDescendants })}
                      </p>
                    )}
                    {selected.openToolsOmitted > 0 && (
                      <p className={css.secondaryFact}>
                        {t('tools.omitted', { count: selected.openToolsOmitted })}
                      </p>
                    )}
                    {selected.pendingInteraction !== undefined && (
                      <InteractionPanel
                        key={selected.pendingInteraction.key}
                        request={selected.pendingInteraction}
                        busy={busySessionId === selected.id}
                        onRespond={(key, response) => run(
                          selected.id,
                          () => respondInteraction(selected.id, key, response),
                        )}
                        t={t}
                      />
                    )}
                    {selected.reason === 'running' && (
                      <SteerControl
                        busy={busySessionId === selected.id}
                        onSteer={text => run(selected.id, () => steerSession(selected.id, text))}
                        t={t}
                      />
                    )}
                    <label className={css.bookmark}>
                      <span>{t('detail.bookmark')}</span>
                      <input
                        value={selected.bookmark ?? ''}
                        placeholder={t('detail.bookmarkPlaceholder')}
                        onChange={(event) => { actions.setBookmark(selected.id, event.currentTarget.value) }}
                      />
                    </label>
                    <div className={css.detailActions}>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<IconFolderOpenOutline16 />}
                        onClick={() => { openSession(selected.id); closeWorkbench() }}
                      >
                        {t('action.open')}
                      </Button>
                      {selected.attention === 'running' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<IconStopFill16 />}
                          disabled={busySessionId === selected.id}
                          onClick={() => { report(run(selected.id, () => cancelSession(selected.id))) }}
                        >
                          {t('action.cancel')}
                        </Button>
                      )}
                      <Menu
                        open={detailMenuOpen}
                        onClose={() => { setDetailMenuOpen(false) }}
                        items={[
                          { id: 'pin', label: t(selected.pinned ? 'action.unpin' : 'action.pin') },
                          {
                            id: 'snooze',
                            label: t(selected.snoozed ? 'action.unsnooze' : 'action.snooze'),
                            disabled: selected.attention === 'needs-action' || selected.attention === 'failed',
                          },
                          {
                            id: 'mark-viewed',
                            label: t('action.markViewed'),
                            icon: <IconCheckOutline16 />,
                            disabled: selected.lastMeaningfulSeq === null,
                          },
                          { type: 'separator', id: 'archive-separator' },
                          {
                            id: 'archive',
                            label: t('action.archive'),
                            icon: <IconArchiveOutline20 size={16} />,
                            disabled: busySessionId === selected.id,
                            danger: true,
                          },
                        ]}
                        onSelect={(action) => {
                          setDetailMenuOpen(false)
                          if (action === 'pin') actions.togglePinned(selected.id)
                          else if (action === 'snooze') {
                            actions.setSnoozedUntil(
                              selected.id,
                              selected.snoozed ? undefined : Date.now() + 60 * 60 * 1_000,
                            )
                          } else if (action === 'mark-viewed' && selected.lastMeaningfulSeq !== null) {
                            actions.markViewed(selected.id, selected.lastMeaningfulSeq)
                          } else if (action === 'archive') {
                            report(run(selected.id, () => archiveSession(selected.id)))
                          }
                        }}
                        align="end"
                        side="top"
                        portal
                        anchor={(
                          <button
                            type="button"
                            className={css.moreActions}
                            aria-label={t('action.more')}
                            onClick={() => { setDetailMenuOpen(open => !open) }}
                          >
                            <IconEllipsisOutline16 />
                          </button>
                        )}
                      />
                    </div>
                  </>)}
            </aside>
          </div>
        </div>
      </Modal>
    </>
  )
}
