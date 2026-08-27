/** Provenance-aware deterministic context summary shared by overview surfaces. */

import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionBriefEventData } from '@deepseek-ai/dsh-session-brief/client'
import type {
  OverviewAttentionReason,
  OverviewContextFact,
  OverviewContextFacts,
  OverviewContextProvenance,
} from './derive.ts'
import css from './ContextSummary.module.css'

/** Context summary inputs derived from existing Session authorities. */
export interface ContextSummaryProps {
  facts: OverviewContextFacts
  reason: OverviewAttentionReason
  lastMeaningfulSeq: number | null
  brief?: SessionBriefEventData | undefined
  collapseSecondary?: boolean
  t: TranslateNS<'sessionOverview'>
}

function provenanceLabel(
  provenance: OverviewContextProvenance,
  t: ContextSummaryProps['t'],
): string {
  return t(`context.provenance.${provenance}`)
}

function Fact({ label, fact, emphasis = false, t }: {
  label: string
  fact: OverviewContextFact
  emphasis?: boolean
  t: ContextSummaryProps['t']
}) {
  return (
    <div className={css.fact} data-emphasis={emphasis || undefined}>
      <div className={css.factLabel}>
        <span>{label}</span>
        <small>{provenanceLabel(fact.provenance, t)}</small>
      </div>
      <p>{fact.text}</p>
    </div>
  )
}

/** Render bounded Task, Focus, Completed, Next, Needs-you, and Freshness facts. */
export function ContextSummary({ facts, reason, lastMeaningfulSeq, brief, collapseSecondary = false, t }: ContextSummaryProps) {
  const hasProgress = facts.currentFocus !== undefined
    || facts.completed.length > 0
    || facts.nextStep !== undefined
  const needsUserProvenance: OverviewContextProvenance = reason === 'goal-blocked'
    ? 'agent-maintained'
    : 'recorded'
  return (
    <div className={css.root}>
      {facts.needsUserReason !== undefined && (
        <Fact
          label={t('context.needsYou')}
          fact={{ text: t(`reason.${facts.needsUserReason}`), provenance: needsUserProvenance }}
          emphasis
          t={t}
        />
      )}
      <Fact label={t('context.task')} fact={facts.task} t={t} />
      {facts.currentFocus !== undefined && (
        <Fact label={t('context.focus')} fact={facts.currentFocus} t={t} />
      )}
      {facts.completed.length > 0 && (
        <details className={css.disclosure} open={!collapseSecondary}>
          <summary className={css.factLabel}>
            <span>{t('context.completed')}</span>
            <small>{provenanceLabel('agent-maintained', t)}</small>
            <IconChevronDownOutline14 />
          </summary>
          <ul>
            {facts.completed.map(item => <li key={item.text}>{item.text}</li>)}
          </ul>
        </details>
      )}
      {facts.nextStep !== undefined && (
        <Fact label={t('context.next')} fact={facts.nextStep} t={t} />
      )}
      {!hasProgress && facts.needsUserReason === undefined && brief === undefined && (
        <p className={css.empty}>{t('context.empty')}</p>
      )}
      <p className={css.freshness}>
        {lastMeaningfulSeq === null
          ? t('context.freshnessUnavailable')
          : t('context.freshness', { seq: lastMeaningfulSeq })}
      </p>
      {brief !== undefined && (
        <GeneratedBrief
          brief={brief}
          lastMeaningfulSeq={lastMeaningfulSeq}
          collapsed={collapseSecondary}
          t={t}
        />
      )}
    </div>
  )
}

function GeneratedBrief({ brief, lastMeaningfulSeq, collapsed, t }: {
  brief: SessionBriefEventData
  lastMeaningfulSeq: number | null
  collapsed: boolean
  t: ContextSummaryProps['t']
}) {
  const stale = lastMeaningfulSeq !== null && lastMeaningfulSeq > brief.sourceSeq
  return (
    <details className={css.generated} data-stale={stale || undefined} open={!collapsed}>
      <summary className={css.generatedHeader}>
        <span>
          <strong>{t('context.generated')}</strong>
          <small>{t('context.generatedBy', {
            provider: brief.provenance.provider,
            model: brief.provenance.model,
          })}</small>
        </span>
        <IconChevronDownOutline14 />
      </summary>
      <div className={css.generatedFacts}>
        <div><span>{t('context.task')}</span><p>{brief.task}</p></div>
        {brief.currentGoal !== undefined && <div><span>{t('context.goal')}</span><p>{brief.currentGoal}</p></div>}
        {brief.currentFocus !== undefined && <div><span>{t('context.focus')}</span><p>{brief.currentFocus}</p></div>}
        {brief.completed.length > 0 && (
          <div><span>{t('context.completed')}</span><ul>{brief.completed.map(item => <li key={item}>{item}</li>)}</ul></div>
        )}
        {brief.nextStep !== undefined && <div><span>{t('context.next')}</span><p>{brief.nextStep}</p></div>}
        {brief.blockers.length > 0 && (
          <div><span>{t('context.blockers')}</span><ul>{brief.blockers.map(item => <li key={item}>{item}</li>)}</ul></div>
        )}
        {brief.waitingForUser !== undefined && <div><span>{t('context.needsYou')}</span><p>{brief.waitingForUser}</p></div>}
      </div>
      <p className={css.generatedFreshness}>
        {lastMeaningfulSeq === null
          ? t('context.generatedFreshnessUnavailable', { sourceSeq: brief.sourceSeq })
          : stale
            ? t('context.generatedStale', { sourceSeq: brief.sourceSeq, latestSeq: lastMeaningfulSeq })
            : t('context.generatedFresh', { sourceSeq: brief.sourceSeq })}
      </p>
    </details>
  )
}
