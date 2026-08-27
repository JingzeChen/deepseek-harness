import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionBriefProviderId } from '@deepseek-ai/dsh-session-brief'
import type { SessionBriefLlmRequestEventData } from '@deepseek-ai/dsh-session-brief-llm'
import * as SessionBriefLlmInvariant from '@deepseek-ai/dsh-session-brief-llm/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SessionBriefLlmInvariant)
  return ctx
}

function requestData(sourceSeq = 0, selectedEventSeqs = [0]): SessionBriefLlmRequestEventData {
  return {
    briefProvider: SessionBriefProviderId('test'),
    sourceSeq,
    selectedEventSeqs,
    route: { provider: 'route', model: 'model' },
    schemaVersion: 1 as const,
    system: 'system',
    messages: [createUserMessage({
      content: [{ type: 'text', text: '{}' }],
      source: { kind: 'plugin' as const, plugin: 'test' },
    })],
    maxTokens: 10,
  }
}

describe('Session brief LLM invariant', () => {
  it('accepts a matched ignorable request and result', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('brief-llm-invariant-valid'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const request = session.append('session/brief-llm-request', requestData(), { ignorable: true })
    expect(() => session.append('session/brief-llm-result', {
      requestEventSeq: request.seq,
      sourceSeq: 0,
      route: { provider: 'route', model: 'model' },
      durationMs: 1,
      outcome: 'generated',
    }, { ignorable: true })).not.toThrow()
  })

  it.each([
    ['required', requestData(), undefined],
    ['future source', requestData(2), { ignorable: true }],
    ['missing selected source', requestData(0, [9]), { ignorable: true }],
    ['unordered selected sources', requestData(1, [1, 0]), { ignorable: true }],
  ])('rejects an invalid %s request', async (_name, data, intent) => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId(`brief-llm-request-${_name}`))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    if (data.sourceSeq === 1) session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const append = () => intent === undefined
      ? session.append('session/brief-llm-request', data)
      : session.append('session/brief-llm-request', data, intent as never)
    expect(append).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-brief-llm',
    }))
  })

  it.each([
    ['required', 1, 0, undefined],
    ['missing request', 9, 0, { ignorable: true }],
    ['wrong source', 1, 1, { ignorable: true }],
  ])('rejects an invalid %s result', async (_name, requestEventSeq, sourceSeq, intent) => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId(`brief-llm-result-${_name}`))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('session/brief-llm-request', requestData(), { ignorable: true })
    const append = () => session.append('session/brief-llm-result', {
      requestEventSeq,
      sourceSeq,
      route: { provider: 'route', model: 'model' },
      durationMs: 1,
      outcome: 'failed',
    }, intent as never)
    expect(append).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-brief-llm',
    }))
  })
})
