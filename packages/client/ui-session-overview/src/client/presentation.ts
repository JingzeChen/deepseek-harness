/** Pure text presentation for deterministic overview row facts. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionOverviewRow } from './derive.ts'
import type {} from './locales.ts'

/**
 * Present the strongest available current-focus fact.
 * @param row - deterministic overview row.
 * @param t - DSH Beacon translator.
 * @returns one bounded focus line.
 */
export function focusText(row: SessionOverviewRow, t: TranslateNS<'sessionOverview'>): string {
  if (row.context.currentFocus !== undefined) return row.context.currentFocus.text
  if (row.blockedReason !== undefined) return row.blockedReason
  if (row.openTools.length > 0) {
    return t('focus.tools', { names: row.openTools.map(tool => tool.name).join(', ') })
  }
  return row.objective
    ?? row.bookmark
    ?? row.brief?.currentFocus
    ?? row.brief?.nextStep
    ?? row.brief?.currentGoal
    ?? row.brief?.task
    ?? t('focus.none')
}

/**
 * Present Todo progress before Goal phase without conflating either with objective truth.
 * @param row - deterministic overview row.
 * @param t - DSH Beacon translator.
 * @returns one progress line.
 */
export function progressText(row: SessionOverviewRow, t: TranslateNS<'sessionOverview'>): string {
  if (row.todo !== null) {
    return t('progress.todo', { completed: row.todo.completed, total: row.todo.total })
  }
  if (row.goalPhase !== undefined) return t('progress.goal', { phase: row.goalPhase })
  return t('progress.none')
}

/**
 * Present a non-negative coarse relative age.
 * @param timestamp - activity epoch milliseconds.
 * @param now - comparison epoch milliseconds.
 * @param t - DSH Beacon translator.
 * @returns localized coarse age.
 */
export function activityText(
  timestamp: number,
  now: number,
  t: TranslateNS<'sessionOverview'>,
): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000)
  if (minutes < 1) return t('time.justNow')
  if (minutes === 1) return t('time.minute')
  if (minutes < 60) return t('time.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return t('time.hour')
  if (hours < 24) return t('time.hours', { count: hours })
  const days = Math.floor(hours / 24)
  return days === 1 ? t('time.day') : t('time.days', { count: days })
}
