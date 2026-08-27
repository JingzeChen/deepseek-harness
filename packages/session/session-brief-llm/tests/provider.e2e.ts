import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService from '@deepseek-ai/dsh-session-brief'
import * as SessionBriefLlm from '@deepseek-ai/dsh-session-brief-llm'
import { evaluateSessionBriefQuality } from './quality-rubric.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('Session brief provider with real DeepSeek API', () => {
  it('produces a cited blocker without inventing completion', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { thinking: 'disabled' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionBriefService, {
      automaticTriggers: [],
      minMeaningfulEvents: 1,
      maxBriefBytes: 4_096,
      maxItemsPerField: 8,
    })
    await ctx.plugin(SessionBriefLlm, {
      maxInputBytes: 8_192,
      maxOutputTokens: 512,
      timeoutMs: 60_000,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    const session = ctx.sessions.create(SessionId('real-session-brief'))
    const source = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Integrate the remote API. No implementation is complete. Work is blocked because API access is missing; request API access next.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const result = await ctx.sessionBrief.refresh(session)

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error(`brief was not accepted: ${result.status}`)
    expect(result.brief.provenance).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    expect(result.brief.provenance.sourceEventSeqs).toContain(source.seq)
    expect(evaluateSessionBriefQuality({
      task: result.brief.task,
      ...(result.brief.currentGoal === undefined ? {} : { currentGoal: result.brief.currentGoal }),
      ...(result.brief.currentFocus === undefined ? {} : { currentFocus: result.brief.currentFocus }),
      completed: result.brief.completed,
      ...(result.brief.nextStep === undefined ? {} : { nextStep: result.brief.nextStep }),
      blockers: result.brief.blockers,
      ...(result.brief.waitingForUser === undefined ? {} : { waitingForUser: result.brief.waitingForUser }),
      sourceEventSeqs: result.brief.provenance.sourceEventSeqs,
      model: result.brief.provenance,
    }, { completedTerms: [], blockerTerms: ['api access'] }).passed).toBe(true)
  })
})
