// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ContextSummary, type ContextSummaryProps } from '../src/client/ContextSummary.tsx'
import { zh } from '../src/client/locales.ts'

const t: ContextSummaryProps['t'] = makeTranslate(zh)
const facts: ContextSummaryProps['facts'] = {
  task: { text: 'Recorded task', provenance: 'recorded' },
  completed: [],
}
const brief = {
  version: 1 as const,
  revision: 1,
  sourceSeq: 4,
  generatedAt: 10,
  task: 'Generated task',
  completed: [],
  blockers: [],
  provenance: { provider: 'route', model: 'model', sourceEventSeqs: [4] },
}

afterEach(cleanup)

describe('generated Context summary freshness', () => {
  it('reports unavailable latest activity without rendering empty generated lists', () => {
    const { container } = render(
      <ContextSummary facts={facts} reason="idle" lastMeaningfulSeq={null} brief={brief} t={t} />,
    )
    expect(screen.getByText('解读覆盖到 4；最新活动序号不可用')).toBeDefined()
    expect(screen.queryByText(zh['context.empty'])).toBeNull()
    expect(container.querySelector('[data-stale]')).toBeNull()
  })

  it('reports a generated brief fresh at the current meaningful sequence', () => {
    const { container } = render(
      <ContextSummary facts={facts} reason="idle" lastMeaningfulSeq={4} brief={brief} t={t} />,
    )
    expect(screen.getByText('已覆盖到活动序号 4')).toBeDefined()
    expect(container.querySelector('[data-stale]')).toBeNull()
  })
})
