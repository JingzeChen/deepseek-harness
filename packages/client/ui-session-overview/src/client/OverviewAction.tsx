/** Sidebar footer trigger for DSH Beacon. */

import { IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { deriveOverviewRows } from './derive.ts'
import type { createSessionOverviewViewStore } from './stores.ts'
import type {} from './locales.ts'
import css from './OverviewAction.module.css'

/** Trigger props derived from the footer slot and shared store. */
export type OverviewActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createSessionOverviewViewStore>>
  & PropsLocale<'sessionOverview'>

/** Render the wide footer command or collapsed rail icon. */
export function OverviewAction({ wide, useSessions, useWorkspaces, useStore, actions, t }: OverviewActionProps) {
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const reviews = useStore(state => state.reviews)
  const attentionCount = deriveOverviewRows(sessions, workspaces, reviews, Date.now())
    .filter(row => !row.snoozed && row.attention !== 'idle' && row.attention !== 'goal-complete')
    .length
  return (
    <Tooltip label={t('trigger.label')} side={wide ? 'top' : 'right'} delayMs={400}>
      <button
        type="button"
        className={css.trigger}
        data-wide={wide ? 'true' : 'false'}
        aria-label={t('trigger.label')}
        onClick={() => { actions.setOpen(true) }}
      >
        <IconListPenOutline16 />
        {wide && <span>{t('trigger.label')}</span>}
        {attentionCount > 0 && (
          <span className={css.badge} aria-label={t('trigger.attentionCount', { count: attentionCount })}>
            {attentionCount > 99 ? '99+' : attentionCount}
          </span>
        )}
      </button>
    </Tooltip>
  )
}
