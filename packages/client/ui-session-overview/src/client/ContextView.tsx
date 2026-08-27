/** Per-Session deterministic catch-up view registered beside Chat and Trajectory. */

import { useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { deriveOverviewRows } from './derive.ts'
import { progressText } from './presentation.ts'
import { ContextSummary } from './ContextSummary.tsx'
import type {} from './locales.ts'
import css from './ContextView.module.css'

/** Props supplied by the Session view slot and the overview locale. */
export type ContextViewProps = ConvViewProps & PropsLocale<'sessionOverview'> & {
  refreshBrief: (sessionId: SessionId) => Promise<void>
}

/** Render current deterministic context without opening the global workbench. */
export function ContextView({ sessionId, useSessions, useWorkspaces, refreshBrief, t }: ContextViewProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const row = useMemo(
    () => deriveOverviewRows(sessions, workspaces, {}, Date.now()).find(item => item.id === sessionId),
    [sessionId, sessions, workspaces],
  )
  if (row === undefined) {
    return <div className={css.root} role="region" aria-label={t('catchup.title')}><p className={css.unavailable}>{t('catchup.unavailable')}</p></div>
  }
  return (
    <div className={css.root} role="region" aria-label={t('catchup.title')}>
      <div className={css.content}>
        <header className={css.header}>
          <div>
            <span className={css.eyebrow}>{t('catchup.title')}</span>
            <h2>{row.title}</h2>
          </div>
          <span className={css.status} data-attention={row.attention}>{t(`status.${row.attention}`)}</span>
        </header>

        <div className={css.meta}>
          <Tooltip label={t('action.refreshBrief')}>
            <button
              type="button"
              className={css.refresh}
              aria-label={t('action.refreshBrief')}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true)
                setRefreshNotice(null)
                void refreshBrief(sessionId).then(
                  () => { setRefreshNotice({ kind: 'success', text: t('action.refreshBriefSucceeded') }) },
                  (error: unknown) => {
                    setRefreshNotice({
                      kind: 'error',
                      text: error instanceof Error && error.message !== ''
                        ? error.message
                        : t('action.refreshBriefFailed'),
                    })
                  },
                ).finally(() => { setRefreshing(false) })
              }}
            >
              <IconRefreshOutline16 />
            </button>
          </Tooltip>
          {row.workspaceTitle !== undefined && <span>{t('catchup.workspace', { workspace: row.workspaceTitle })}</span>}
          <span>{progressText(row, t)}</span>
          {row.runningDescendants > 0 && <span>{t('catchup.descendants', { count: row.runningDescendants })}</span>}
          {row.openTools.length > 0 && (
            <span>{t('catchup.tools', { tools: row.openTools.map(tool => tool.name).join(', ') })}</span>
          )}
        </div>

        {refreshing && <p className={css.refreshNotice} role="status">{t('action.refreshBriefRunning')}</p>}
        {refreshNotice !== null && (
          <p
            className={refreshNotice.kind === 'error' ? css.refreshError : css.refreshNotice}
            role={refreshNotice.kind === 'error' ? 'alert' : 'status'}
          >
            {refreshNotice.text}
          </p>
        )}

        <main className={css.summary}>
          <ContextSummary
            facts={row.context}
            reason={row.reason}
            lastMeaningfulSeq={row.lastMeaningfulSeq}
            brief={row.brief}
            t={t}
          />
        </main>
      </div>
    </div>
  )
}
