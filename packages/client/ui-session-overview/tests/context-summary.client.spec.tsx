// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ContextSummary } from '../src/client/ContextSummary.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

describe('ContextSummary', () => {
  it('renders every deterministic context field with its provenance and freshness', () => {
    render(<ContextSummary
      facts={{
        task: { text: 'Ship context view', provenance: 'recorded' },
        currentFocus: { text: 'Wire the context card', provenance: 'agent-maintained' },
        completed: [
          { text: 'Derive context facts', provenance: 'agent-maintained' },
          { text: 'Add provenance', provenance: 'agent-maintained' },
        ],
        nextStep: { text: 'Inspect the mobile layout', provenance: 'user' },
        needsUserReason: 'goal-blocked',
      }}
      reason="goal-blocked"
      lastMeaningfulSeq={17}
      t={t}
    />)
    for (const text of [
      zh['context.task'],
      zh['context.focus'],
      zh['context.completed'],
      zh['context.next'],
      zh['context.needsYou'],
      'Ship context view',
      'Wire the context card',
      'Derive context facts',
      'Add provenance',
      'Inspect the mobile layout',
      zh['reason.goal-blocked'],
      '覆盖到活动序号 17',
    ]) expect(screen.getByText(text)).toBeDefined()
    expect(screen.getAllByText(zh['context.provenance.agent-maintained']).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(zh['context.provenance.recorded'])).toBeDefined()
    expect(screen.getByText(zh['context.provenance.user'])).toBeDefined()
  })

  it('states when structured progress and freshness are unavailable', () => {
    render(<ContextSummary
      facts={{ task: { text: 'Untitled task', provenance: 'recorded' }, completed: [] }}
      reason="idle"
      lastMeaningfulSeq={null}
      t={t}
    />)
    expect(screen.getByText(zh['context.empty'])).toBeDefined()
    expect(screen.getByText(zh['context.freshnessUnavailable'])).toBeDefined()
  })
})
