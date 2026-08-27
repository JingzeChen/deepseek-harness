import { describe, expect, it } from 'vitest'
import type { SessionBriefProviderResult } from '@deepseek-ai/dsh-session-brief'
import { evaluateSessionBriefQuality } from './quality-rubric.ts'

const EVIDENCE = {
  completedTerms: [],
  blockerTerms: ['api access'],
} as const

function candidate(overrides: Partial<SessionBriefProviderResult> = {}): SessionBriefProviderResult {
  return {
    task: 'Integrate the remote API',
    completed: [],
    blockers: ['Missing API access'],
    nextStep: 'Request API access',
    sourceEventSeqs: [0],
    model: { provider: 'fixture', model: 'brief' },
    ...overrides,
  }
}

describe('Session brief offline quality rubric', () => {
  it('accepts a grounded blocker and no completion claim', () => {
    expect(evaluateSessionBriefQuality(candidate(), EVIDENCE)).toEqual({
      inventedCompletion: [],
      omittedBlockers: [],
      passed: true,
    })
  })

  it('flags invented completion and an omitted blocker independently', () => {
    expect(evaluateSessionBriefQuality(candidate({
      completed: ['API integration is complete'],
      blockers: [],
    }), EVIDENCE)).toEqual({
      inventedCompletion: ['API integration is complete'],
      omittedBlockers: ['api access'],
      passed: false,
    })
  })
})
