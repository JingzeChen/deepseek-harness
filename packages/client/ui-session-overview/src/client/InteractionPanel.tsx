/** Compact Host-authoritative interaction and steering controls for the overview. */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingInteractionRequest } from '@deepseek-ai/dsh-client-runtime/client'
import type { OverviewInteractionResponse, OverviewWorkbenchProps } from './OverviewWorkbench.tsx'
import css from './OverviewWorkbench.module.css'

type QuestionRequest = Extract<PendingInteractionRequest, { kind: 'question' }>
type QuestionItem = QuestionRequest['payload']['questions'][number]

interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

interface PlanDecision {
  question: QuestionItem
  approve: NonNullable<QuestionItem['options']>[number]
  decline?: NonNullable<QuestionItem['options']>[number]
}

function report(operation: Promise<void>): void {
  void operation.catch(() => {})
}

function planDecision(request: QuestionRequest): PlanDecision | undefined {
  if (request.status !== 'plan-review' || request.payload.questions.length !== 1) return undefined
  const question = request.payload.questions[0]
  if (question === undefined || question.intent?.kind !== 'plan-review') return undefined
  const approve = question.options?.find(option => option.label === question.intent?.approve)
  if (approve === undefined) return undefined
  const decline = question.options?.find(option => option.label !== approve.label)
  return { question, approve, ...(decline === undefined ? {} : { decline }) }
}

/** Props for one selected Session interaction. */
export interface InteractionPanelProps {
  request: PendingInteractionRequest
  busy: boolean
  onRespond: (key: string, response: OverviewInteractionResponse) => Promise<void>
  t: OverviewWorkbenchProps['t']
}

/** Render the selected Session's current approval, plan review, or question batch. */
export function InteractionPanel({ request, busy, onRespond, t }: InteractionPanelProps) {
  if (request.kind === 'approval') {
    return (
      <section className={css.interaction} aria-label={t('interaction.title')}>
        <strong>{t('interaction.title')}</strong>
        <p>{request.payload.reason ?? t('interaction.approvalFallback', { toolName: request.payload.toolName })}</p>
        <div className={css.interactionActions}>
          <Button
            size="sm" variant="outline" disabled={busy}
            onClick={() => { report(onRespond(request.key, { kind: 'approval', outcome: 'rejected' })) }}
          >
            {t('interaction.reject')}
          </Button>
          <Button
            size="sm" variant="primary" disabled={busy}
            onClick={() => { report(onRespond(request.key, { kind: 'approval', outcome: 'allowed-once' })) }}
          >
            {t('interaction.allowOnce')}
          </Button>
        </div>
      </section>
    )
  }

  const plan = planDecision(request)
  if (plan !== undefined) {
    const decline = plan.decline
    return (
      <section className={css.interaction} aria-label={plan.question.question}>
        <strong>{t('interaction.plan')}</strong>
        <div className={css.planBody}>{plan.question.detail}</div>
        <div className={css.interactionActions}>
          <Button
            size="sm" variant="ghost" disabled={busy}
            onClick={() => { report(onRespond(request.key, { kind: 'question-cancel' })) }}
          >
            {t('interaction.discuss')}
          </Button>
          {decline !== undefined && (
            <Button
              size="sm" variant="outline" disabled={busy} title={decline.description}
              onClick={() => {
                report(onRespond(request.key, {
                  kind: 'question',
                  answer: { answers: [{ id: plan.question.id, selected: [decline.label] }] },
                }))
              }}
            >
              {t('interaction.planDecline')}
            </Button>
          )}
          <Button
            size="sm" variant="primary" disabled={busy} title={plan.approve.description}
            onClick={() => {
              report(onRespond(request.key, {
                kind: 'question',
                answer: { answers: [{ id: plan.question.id, selected: [plan.approve.label] }] },
              }))
            }}
          >
            {t('interaction.planApprove')}
          </Button>
        </div>
      </section>
    )
  }

  return <QuestionPanel request={request} busy={busy} onRespond={onRespond} t={t} />
}

function QuestionPanel({ request, busy, onRespond, t }: InteractionPanelProps & { request: QuestionRequest }) {
  const questions = request.payload.questions
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() => questions.map(() => ({
    selected: [], custom: '', skipped: false,
  })))
  const [incomplete, setIncomplete] = useState(false)
  const update = (index: number, next: (draft: DraftAnswer) => DraftAnswer): void => {
    setDrafts(current => current.map((draft, candidate) => candidate === index ? next(draft) : draft))
    setIncomplete(false)
  }
  const submit = (): void => {
    if (drafts.some(draft => draft.selected.length === 0 && draft.custom.trim() === '' && !draft.skipped)) {
      setIncomplete(true)
      return
    }
    const answer = {
      answers: questions.map((question, index) => {
        const draft = drafts[index]
        /* v8 ignore next -- drafts are initialized from and updated with the same question array. */
        if (draft === undefined) return { id: question.id, selected: [] }
        if (draft.skipped) return { id: question.id, selected: [] }
        const custom = draft.custom.trim()
        return {
          id: question.id,
          selected: custom === '' || question.multiSelect === true ? draft.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    report(onRespond(request.key, { kind: 'question', answer }))
  }

  return (
    <section className={css.interaction} aria-label={t('interaction.question')}>
      <strong>{t('interaction.question')}</strong>
      {questions.map((question, index) => {
        const draft = drafts[index]
        /* v8 ignore next -- drafts are initialized from and updated with the same question array. */
        if (draft === undefined) return null
        return (
          <fieldset key={question.id} className={css.question} disabled={busy}>
            <legend>{question.header ?? question.question}</legend>
            {question.header !== undefined && <p>{question.question}</p>}
            {question.detail !== undefined && <p className={css.interactionDetail}>{question.detail}</p>}
            {question.options?.map(option => (
              <label key={option.label} className={css.option} title={option.description}>
                <input
                  type={question.multiSelect === true ? 'checkbox' : 'radio'}
                  name={`${request.key}-${question.id}`}
                  checked={draft.selected.includes(option.label)}
                  onChange={() => {
                    update(index, current => question.multiSelect === true
                      ? {
                        ...current,
                        selected: current.selected.includes(option.label)
                          ? current.selected.filter(label => label !== option.label)
                          : [...current.selected, option.label],
                        skipped: false,
                      }
                      : { selected: [option.label], custom: '', skipped: false })
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
            <label className={css.customAnswer}>
              <span>{t('interaction.custom')}</span>
              <textarea
                value={draft.custom}
                placeholder={t('interaction.customPlaceholder')}
                onChange={(event) => {
                  const custom = event.currentTarget.value
                  update(index, current => ({
                    ...current,
                    selected: question.multiSelect === true ? current.selected : [],
                    custom,
                    skipped: false,
                  }))
                }}
              />
            </label>
            <label className={css.option}>
              <input
                type="checkbox"
                checked={draft.skipped}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  update(index, current => checked
                    ? { selected: [], custom: '', skipped: true }
                    : { ...current, skipped: false })
                }}
              />
              <span>{t('interaction.skip')}</span>
            </label>
          </fieldset>
        )
      })}
      {incomplete && <p role="alert" className={css.error}>{t('interaction.incomplete')}</p>}
      <div className={css.interactionActions}>
        <Button
          size="sm" variant="ghost" disabled={busy}
          onClick={() => { report(onRespond(request.key, { kind: 'question-cancel' })) }}
        >
          {t('interaction.discuss')}
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={submit}>
          {t('interaction.answer')}
        </Button>
      </div>
    </section>
  )
}

/** Props for the running-Session steering control. */
export interface SteerControlProps {
  busy: boolean
  onSteer: (text: string) => Promise<void>
  t: OverviewWorkbenchProps['t']
}

/** Send one text instruction into the selected Session's current Turn. */
export function SteerControl({ busy, onSteer, t }: SteerControlProps) {
  const [text, setText] = useState('')
  const send = (): void => {
    const value = text.trim()
    /* v8 ignore next -- the native disabled button cannot invoke send for blank text. */
    if (value === '') return
    report(onSteer(value).then(() => { setText('') }))
  }
  return (
    <section className={css.steer} aria-label={t('steer.label')}>
      <label>
        <span>{t('steer.label')}</span>
        <textarea
          value={text}
          placeholder={t('steer.placeholder')}
          disabled={busy}
          onChange={(event) => { setText(event.currentTarget.value) }}
        />
      </label>
      <Button size="sm" variant="outline" disabled={busy || text.trim() === ''} onClick={send}>
        {t('steer.send')}
      </Button>
    </section>
  )
}
