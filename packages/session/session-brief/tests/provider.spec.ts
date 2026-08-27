import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService, {
  SessionBriefProviderId,
  type Config,
  type SessionBriefProviderRequest,
  type SessionBriefProviderResult,
} from '@deepseek-ai/dsh-session-brief'

const CONFIG: Config = {
  automaticTriggers: [],
  minMeaningfulEvents: 1,
  maxBriefBytes: 1024,
  maxItemsPerField: 4,
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function candidate(sourceSeq: number): SessionBriefProviderResult {
  return {
    task: '  Ship   the brief  ',
    currentFocus: ' Validate lifecycle ',
    completed: ['Service contract'],
    nextStep: 'Connect provider',
    blockers: [],
    sourceEventSeqs: [sourceSeq],
    model: { provider: 'test-route', model: 'brief-model' },
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionBriefService, CONFIG)
  return ctx
}

describe('SessionBriefService provider lifecycle', () => {
  it('reports capability and source absence without writing events', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('brief-absent'))
    expect(await ctx.sessionBrief.refresh(session)).toEqual({ status: 'unavailable', reason: 'no-provider' })
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('test'),
      generate: async request => candidate(request.sourceSeq),
    })
    expect(await ctx.sessionBrief.refresh(session)).toEqual({ status: 'unavailable', reason: 'no-meaningful-events' })
    expect(session.events).toEqual([])
  })

  it('normalizes and accepts a complete cited candidate as an ignorable event', async () => {
    const ctx = await harness()
    const requests: SessionBriefProviderRequest[] = []
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('test'),
      async generate(request) {
        requests.push(request)
        return candidate(request.sourceSeq)
      },
    })
    const session = ctx.sessions.create(SessionId('brief-accepted'))
    const source = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const result = await ctx.sessionBrief.refresh(session)

    expect(result).toMatchObject({ status: 'accepted', brief: {
      version: 1,
      revision: 1,
      sourceSeq: source.seq,
      task: 'Ship the brief',
      currentFocus: 'Validate lifecycle',
      provenance: { provider: 'test-route', model: 'brief-model', sourceEventSeqs: [source.seq] },
    } })
    expect(requests[0]).toMatchObject({ session, sourceSeq: source.seq, events: [source] })
    expect(session.events.at(-1)).toMatchObject({ type: 'session/brief', ignorable: true })
  })

  it('aborts a stale completion after newer meaningful activity and retains the prior brief', async () => {
    const ctx = await harness()
    const pending = deferred<SessionBriefProviderResult>()
    const requests: SessionBriefProviderRequest[] = []
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('test'),
      generate(request) {
        requests.push(request)
        return requests.length === 1 ? Promise.resolve(candidate(request.sourceSeq)) : pending.promise
      },
    })
    const session = ctx.sessions.create(SessionId('brief-stale'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await ctx.sessionBrief.refresh(session)).status).toBe('accepted')
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const refresh = ctx.sessionBrief.refresh(session)
    await Promise.resolve()
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    expect(requests[1]?.signal.aborted).toBe(true)
    pending.resolve(candidate(requests[1]!.sourceSeq))

    expect(await refresh).toEqual({ status: 'failed', reason: 'stale' })
    expect(ctx.sessionBrief.get(session)?.sourceSeq).toBe(0)
    expect(session.events.filter(event => event.type === 'session/brief')).toHaveLength(1)
  })

  it('rejects unknown output fields and keeps the previous accepted brief', async () => {
    const ctx = await harness()
    let invalid = false
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('test'),
      generate: async request => invalid
        ? { ...candidate(request.sourceSeq), permission: 'granted' } as never
        : candidate(request.sourceSeq),
    })
    const session = ctx.sessions.create(SessionId('brief-invalid'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await ctx.sessionBrief.refresh(session)).status).toBe('accepted')
    const prior = ctx.sessionBrief.get(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    invalid = true

    expect(await ctx.sessionBrief.refresh(session)).toEqual({ status: 'failed', reason: 'invalid-result' })
    expect(ctx.sessionBrief.get(session)).toBe(prior)
  })

  it('runs enabled automatic triggers, applies minimum advance, and retains a brief after failure', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionBriefService, { ...CONFIG, automaticTriggers: ['turn-end'], minMeaningfulEvents: 2 })
    let calls = 0
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('automatic'),
      async generate(request) {
        calls += 1
        if (calls === 2) throw new Error('provider unavailable')
        return candidate(request.sourceSeq)
      },
    })
    const session = ctx.sessions.create(SessionId('brief-automatic'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(0)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second meaningful event' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    const accepted = ctx.sessionBrief.get(session)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'another meaningful event' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(2)
    expect(ctx.sessionBrief.get(session)).toBe(accepted)
  })

  it('aborts and drains active work for caller and provider disposal', async () => {
    const ctx = await harness()
    const pending = deferred<SessionBriefProviderResult>()
    const signals: AbortSignal[] = []
    const disposeProvider = ctx.sessionBrief.register({
      id: SessionBriefProviderId('disposal'),
      generate(request) {
        signals.push(request.signal)
        return pending.promise
      },
    })
    const session = ctx.sessions.create(SessionId('brief-disposal'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const caller = new AbortController()
    const refresh = ctx.sessionBrief.refresh(session, caller.signal)
    await Promise.resolve()
    caller.abort(new Error('caller stopped'))
    pending.resolve(candidate(0))
    expect(await refresh).toEqual({ status: 'failed', reason: 'cancelled' })

    const second = deferred<SessionBriefProviderResult>()
    const replacement = { promise: second.promise }
    await disposeProvider()
    const disposeReplacement = ctx.sessionBrief.register({
      id: SessionBriefProviderId('replacement'),
      generate(request) {
        signals.push(request.signal)
        return replacement.promise
      },
    })
    const providerRefresh = ctx.sessionBrief.refresh(session)
    await Promise.resolve()
    const disposal = disposeReplacement()
    expect(signals.at(-1)?.aborted).toBe(true)
    second.resolve(candidate(0))
    await disposal
    expect(await providerRefresh).toEqual({ status: 'failed', reason: 'cancelled' })
  })

  it('aborts active work when the Session owner fiber disposes', async () => {
    const ctx = await harness()
    const pending = deferred<SessionBriefProviderResult>()
    let observedSignal: AbortSignal | undefined
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('session-disposal'),
      generate(request) {
        observedSignal = request.signal
        return pending.promise
      },
    })
    let session!: ReturnType<Context['sessions']['create']>
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create(SessionId('brief-session-disposal'))
    }, { inject: ['sessions'] }))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const refresh = ctx.sessionBrief.refresh(session)
    await Promise.resolve()

    await owner.dispose()
    expect(observedSignal?.aborted).toBe(true)
    pending.resolve(candidate(0))
    expect(await refresh).toEqual({ status: 'failed', reason: 'cancelled' })
    expect(ctx.sessions.get(session.id)).toBeUndefined()
  })
})
