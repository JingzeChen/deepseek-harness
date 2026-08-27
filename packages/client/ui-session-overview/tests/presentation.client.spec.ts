import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionOverviewRow } from '../src/client/derive.ts'
import { activityText, focusText, progressText } from '../src/client/presentation.ts'
import { en, zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const english = makeTranslate(en)

function row(overrides: Partial<SessionOverviewRow> = {}): SessionOverviewRow {
  return {
    id: 'session' as SessionOverviewRow['id'],
    title: 'Session',
    attention: 'idle',
    reason: 'idle',
    runningDescendants: 0,
    updatedAt: 0,
    lastMeaningfulAt: 0,
    lastMeaningfulSeq: null,
    openTools: [],
    openToolsOmitted: 0,
    todo: null,
    context: {
      task: { text: 'Session', provenance: 'recorded' },
      completed: [],
    },
    pinned: false,
    snoozed: false,
    ...overrides,
  }
}

describe('overview row presentation', () => {
  it('selects deterministic focus before generated interpretation and unavailable copy', () => {
    expect(focusText(row({
      context: {
        task: { text: 'Session', provenance: 'recorded' },
        currentFocus: { text: 'Implement context', provenance: 'agent-maintained' },
        completed: [],
      },
    }), t)).toBe('Implement context')
    expect(focusText(row({ blockedReason: 'Blocked' }), t)).toBe('Blocked')
    expect(focusText(row({ openTools: [{ callId: 'one', name: 'read', startedAt: 0 }] }), t)).toBe('工具：read')
    expect(focusText(row({ objective: 'Ship' }), t)).toBe('Ship')
    expect(focusText(row({ bookmark: 'Inspect' }), t)).toBe('Inspect')
    expect(focusText(row({ brief: {
      version: 1,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 0,
      task: 'Generated task',
      currentGoal: 'Generated goal',
      currentFocus: 'Generated focus',
      completed: [],
      nextStep: 'Generated next',
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0] },
    } }), t)).toBe('Generated focus')
    expect(focusText(row({ brief: {
      version: 1,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 0,
      task: 'Generated task',
      completed: [],
      nextStep: 'Generated next',
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0] },
    } }), t)).toBe('Generated next')
    expect(focusText(row({ brief: {
      version: 1,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 0,
      task: 'Generated task',
      currentGoal: 'Generated goal',
      completed: [],
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0] },
    } }), t)).toBe('Generated goal')
    expect(focusText(row({ brief: {
      version: 1,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 0,
      task: 'Generated task',
      completed: [],
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0] },
    } }), t)).toBe('Generated task')
    expect(focusText(row(), t)).toBe('尚无可用焦点')
  })

  it('keeps Todo, Goal, and missing progress distinct', () => {
    expect(progressText(row({ todo: { total: 2, completed: 1, pending: 1, inProgress: 0 } }), t)).toBe('Todo 1/2')
    expect(progressText(row({ goalPhase: 'paused' }), t)).toBe('Goal：paused')
    expect(progressText(row(), t)).toBe('未提供进度')
  })

  it('formats skew, minute, hour, and day ages without negatives', () => {
    expect(activityText(2_000, 1_000, t)).toBe('刚刚')
    expect(activityText(0, 5 * 60_000, t)).toBe('5 分钟前')
    expect(activityText(0, 3 * 60 * 60_000, t)).toBe('3 小时前')
    expect(activityText(0, 2 * 24 * 60 * 60_000, t)).toBe('2 天前')
    expect(activityText(0, 60_000, english)).toBe('1 minute ago')
    expect(activityText(0, 60 * 60_000, english)).toBe('1 hour ago')
    expect(activityText(0, 24 * 60 * 60_000, english)).toBe('1 day ago')
  })
})
