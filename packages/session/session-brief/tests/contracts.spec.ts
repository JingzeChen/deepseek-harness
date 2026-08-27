import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService, {
  SessionBriefProviderId,
  type Config,
  type SessionBriefProviderRequest,
  type SessionBriefProviderResult,
} from '@deepseek-ai/dsh-session-brief'

const CONFIG: Config = {
  automaticTriggers: [],
  minMeaningfulEvents: 1,
  maxBriefBytes: 2_000,
  maxItemsPerField: 3,
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function valid(sourceSeq: number): SessionBriefProviderResult {
  return {
    task: 'Task',
    currentGoal: 'Goal',
    currentFocus: 'Focus',
    completed: ['Done'],
    nextStep: 'Next',
    blockers: ['Blocked'],
    waitingForUser: 'Answer',
    sourceEventSeqs: [sourceSeq],
    model: { provider: 'route', model: 'model' },
  }
}

async function service(config: Config = CONFIG): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(SessionBriefService, config)
  return { ctx, fiber }
}

function source(session: Session) {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'source' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('SessionBriefService contracts', () => {
  it.each([
    [undefined, /invalid config/],
    [null, /invalid config/],
    [{ ...CONFIG, automaticTriggers: undefined }, /automaticTriggers/],
    [{ ...CONFIG, minMeaningfulEvents: 0 }, /minMeaningfulEvents/],
    [{ ...CONFIG, maxBriefBytes: 1.5 }, /maxBriefBytes/],
    [{ ...CONFIG, maxItemsPerField: -1 }, /maxItemsPerField/],
    [{ ...CONFIG, automaticTriggers: ['turn-end', 'turn-end'] }, /unique supported subset/],
    [{ ...CONFIG, automaticTriggers: ['future'] }, /automaticTriggers/],
  ] as const)('rejects invalid configuration %#', async (config, expected) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(ctx.plugin(SessionBriefService, config as never)).rejects.toThrow(expected)
  })

  it.each([
    [undefined, /configuration is required/],
    [{ ...CONFIG, automaticTriggers: undefined }, /configuration is required/],
    [{ ...CONFIG, minMeaningfulEvents: 0 }, /minMeaningfulEvents.*positive integer/],
    [{ ...CONFIG, maxBriefBytes: 1.5 }, /maxBriefBytes.*positive integer/],
    [{ ...CONFIG, maxItemsPerField: -1 }, /maxItemsPerField.*positive integer/],
    [{ ...CONFIG, automaticTriggers: ['turn-end', 'turn-end'] }, /unique supported subset/],
    [{ ...CONFIG, automaticTriggers: ['future'] }, /unique supported subset/],
  ] as const)('defends direct construction against invalid configuration %#', async (config, expected) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    expect(() => new SessionBriefService(ctx, config as never)).toThrow(expected)
  })

  it('validates provider registration and live Session ownership', async () => {
    const { ctx } = await service()
    expect(() => ctx.sessionBrief.register(null as never)).toThrow(/must be an object/)
    expect(() => ctx.sessionBrief.register({ id: 1, generate: async () => valid(0) } as never)).toThrow(/non-empty string/)
    expect(() => ctx.sessionBrief.register({ id: '', generate: async () => valid(0) } as never)).toThrow(/non-empty string/)
    expect(() => ctx.sessionBrief.register({ id: SessionBriefProviderId('missing') } as never)).toThrow(/requires generate/)
    const dispose = ctx.sessionBrief.register({ id: SessionBriefProviderId('one'), generate: async () => valid(0) })
    expect(() => ctx.sessionBrief.register({ id: SessionBriefProviderId('two'), generate: async () => valid(0) }))
      .toThrow(/already registered/)
    await expect(ctx.sessionBrief.refresh(Session.create(SessionId('detached')))).rejects.toThrow(/not live/)
    await dispose()
  })

  it('passes prior brief and logged route, normalizes every optional field, and advances revision', async () => {
    const { ctx } = await service()
    const requests: unknown[] = []
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('complete'),
      async generate(request) {
        requests.push(request)
        return {
          ...valid(request.sourceSeq),
          task: '  Task   text ',
          currentGoal: ' Goal ',
          currentFocus: ' Focus ',
          nextStep: ' Next ',
          waitingForUser: ' Answer ',
          model: { provider: ' route ', model: ' model ' },
        }
      },
    })
    const session = ctx.sessions.create(SessionId('brief-complete-fields'))
    source(session)
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'chat' } },
      reason: 'initial',
    })
    const first = await ctx.sessionBrief.refresh(session)
    source(session)
    const second = await ctx.sessionBrief.refresh(session)
    expect(first).toMatchObject({ status: 'accepted', brief: { revision: 1, task: 'Task text' } })
    expect(second).toMatchObject({ status: 'accepted', brief: {
      revision: 2,
      currentGoal: 'Goal',
      currentFocus: 'Focus',
      nextStep: 'Next',
      waitingForUser: 'Answer',
      provenance: { provider: 'route', model: 'model' },
    } })
    expect(requests[0]).toMatchObject({ route: { provider: 'main', model: 'chat' } })
    expect(requests[1]).toMatchObject({ previous: { revision: 1 } })
  })

  it('rejects every malformed provider field and retains no invalid event', async () => {
    const { ctx } = await service({ ...CONFIG, maxBriefBytes: 400 })
    let output: unknown = valid(0)
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('invalid'),
      generate: async () => output as SessionBriefProviderResult,
    })
    const invalid: unknown[] = [
      null,
      [],
      { ...valid(0), task: 1 },
      { ...valid(0), task: '  ' },
      { ...valid(0), completed: 'done' },
      { ...valid(0), completed: ['a', 'b', 'c', 'd'] },
      { ...valid(0), completed: [1] },
      { ...valid(0), completed: ['same', 'same'] },
      { ...valid(0), sourceEventSeqs: '0' },
      { ...valid(0), sourceEventSeqs: [] },
      { ...valid(0), sourceEventSeqs: [0, 0] },
      { ...valid(0), sourceEventSeqs: [-1] },
      { ...valid(0), sourceEventSeqs: [1] },
      { ...valid(0), sourceEventSeqs: ['0'] },
      { ...valid(0), model: null },
      { ...valid(0), model: [] },
      { ...valid(0), model: { provider: '', model: 'm' } },
      { ...valid(0), model: { provider: 'p', model: 1 } },
      { ...valid(0), model: { provider: 'p', model: 'm', extra: true } },
      { ...valid(0), task: 'x'.repeat(500) },
      { ...valid(0), extra: true },
    ]
    for (const [index, candidate] of invalid.entries()) {
      const session = ctx.sessions.create(SessionId(`brief-invalid-${index}`))
      source(session)
      output = candidate
      await expect(ctx.sessionBrief.refresh(session)).resolves.toEqual({ status: 'failed', reason: 'invalid-result' })
      expect(session.events.some(event => event.type === 'session/brief')).toBe(false)
    }
  })

  it('accepts a candidate containing only required fields', async () => {
    const { ctx } = await service()
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('minimal'),
      async generate(request) {
        return {
          task: 'Minimal',
          completed: [],
          blockers: [],
          sourceEventSeqs: [request.sourceSeq],
          model: { provider: 'route', model: 'model' },
        }
      },
    })
    const session = ctx.sessions.create(SessionId('brief-minimal'))
    source(session)
    expect(await ctx.sessionBrief.refresh(session)).toMatchObject({
      status: 'accepted',
      brief: { task: 'Minimal' },
    })
  })

  it('distinguishes provider failure, pre-cancellation, active work, and running Agent state', async () => {
    const { ctx } = await service()
    let mode: 'throw' | 'pending' = 'throw'
    const pending = deferred<SessionBriefProviderResult>()
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('outcomes'),
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise provider-failed normalization for arbitrary throws
      generate: () => mode === 'throw' ? Promise.reject('non-error failure') : pending.promise,
    })
    const failed = ctx.sessions.create(SessionId('brief-provider-failed'))
    source(failed)
    expect(await ctx.sessionBrief.refresh(failed)).toEqual({ status: 'failed', reason: 'provider-failed' })
    const cancelled = new AbortController()
    cancelled.abort(new DOMException('cancelled', 'AbortError'))
    expect(await ctx.sessionBrief.refresh(failed, cancelled.signal)).toEqual({ status: 'failed', reason: 'cancelled' })

    mode = 'pending'
    const active = ctx.sessions.create(SessionId('brief-active'))
    source(active)
    const first = ctx.sessionBrief.refresh(active)
    await Promise.resolve()
    expect(await ctx.sessionBrief.refresh(active)).toEqual({ status: 'busy' })
    pending.resolve(valid(0))
    expect((await first).status).toBe('accepted')

    const agentCtx = new Context()
    await agentCtx.plugin(SessionStore)
    await agentCtx.plugin(AgentRegistry)
    await agentCtx.plugin(SessionBriefService, CONFIG)
    agentCtx.sessionBrief.register({ id: SessionBriefProviderId('agent'), generate: async request => valid(request.sourceSeq) })
    const runningSession = agentCtx.sessions.create(SessionId('brief-running-agent'))
    source(runningSession)
    const runningAgent = { id: runningSession.id, session: runningSession, ctx: agentCtx, status: 'running' } as never
    agentCtx.agents.register(runningAgent)
    expect(await agentCtx.sessionBrief.refresh(runningSession)).toEqual({ status: 'busy' })
  })

  it('preserves a provider failure code without exposing provider content', async () => {
    const { ctx } = await service()
    const failure = Object.assign(new Error('private provider detail'), { code: 'SESSION_BRIEF_OUTPUT_SCHEMA' })
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('coded-failure'),
      generate: () => Promise.reject(failure),
    })
    const session = ctx.sessions.create(SessionId('brief-coded-failure'))
    source(session)

    expect(await ctx.sessionBrief.refresh(session)).toEqual({
      status: 'failed',
      reason: 'provider-failed',
      code: 'SESSION_BRIEF_OUTPUT_SCHEMA',
    })
  })

  it('uses Agent maintenance and reports a synchronous maintenance race as busy', async () => {
    const { ctx } = await service()
    await ctx.plugin(AgentRegistry)
    ctx.sessionBrief.register({ id: SessionBriefProviderId('maintenance'), generate: async request => valid(request.sourceSeq) })
    const acceptedSession = ctx.sessions.create(SessionId('brief-maintenance'))
    source(acceptedSession)
    const maintenance = vi.fn((task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal))
    ctx.agents.register({
      id: acceptedSession.id,
      session: acceptedSession,
      ctx,
      status: 'idle',
      runMaintenance: maintenance,
    } as never)
    expect((await ctx.sessionBrief.refresh(acceptedSession)).status).toBe('accepted')
    expect(maintenance).toHaveBeenCalledOnce()

    const racedSession = ctx.sessions.create(SessionId('brief-maintenance-race'))
    source(racedSession)
    ctx.agents.register({
      id: racedSession.id,
      session: racedSession,
      ctx,
      status: 'idle',
      runMaintenance: () => { throw new Error('busy') },
    } as never)
    expect(await ctx.sessionBrief.refresh(racedSession)).toEqual({ status: 'busy' })
  })

  it('runs goal-blocked and turn-error automatic triggers after Agent idle', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionBriefService, { ...CONFIG, automaticTriggers: ['goal-blocked', 'turn-error'] })
    const generated: number[] = []
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('automatic-kinds'),
      async generate(request) {
        generated.push(request.sourceSeq)
        return valid(request.sourceSeq)
      },
    })
    const session = ctx.sessions.create(SessionId('brief-auto-kinds'))
    const whenIdle = vi.fn(async () => {})
    const runMaintenance = vi.fn((task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal))
    ctx.agents.register({ id: session.id, session, ctx, status: 'idle', whenIdle, runMaintenance } as never)
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'block',
      goal: {
        id: 'goal' as never,
        revision: 1,
        objective: 'Task',
        phase: 'blocked',
        blockedReason: { code: 'needs-user', message: 'Need input' },
        maxGoalRounds: 3,
      },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 2,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'FAILED', message: 'failed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(generated).toEqual([0, 2])
    expect(whenIdle).toHaveBeenCalledTimes(2)
    expect(runMaintenance).toHaveBeenCalledTimes(2)
  })

  it('coalesces stale queued work, handles automatic maintenance races, and ignores absent or closing providers', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionBriefService, { ...CONFIG, automaticTriggers: ['turn-end'] })
    const noProvider = ctx.sessions.create(SessionId('brief-auto-no-provider'))
    noProvider.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const generate = vi.fn(async (request: SessionBriefProviderRequest) => valid(request.sourceSeq))
    const dispose = ctx.sessionBrief.register({ id: SessionBriefProviderId('automatic-races'), generate })
    const stale = ctx.sessions.create(SessionId('brief-auto-stale-queued'))
    stale.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    source(stale)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(generate).not.toHaveBeenCalled()

    const maintenanceRace = ctx.sessions.create(SessionId('brief-auto-maintenance-race'))
    ctx.agents.register({
      id: maintenanceRace.id,
      session: maintenanceRace,
      ctx,
      status: 'idle',
      whenIdle: async () => {},
      runMaintenance: () => { throw new Error('claimed') },
    } as never)
    maintenanceRace.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(generate).not.toHaveBeenCalled()

    const pending = deferred<SessionBriefProviderResult>()
    generate.mockImplementationOnce(() => pending.promise)
    const closing = ctx.sessions.create(SessionId('brief-auto-closing'))
    closing.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    const disposal = dispose()
    closing.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    pending.resolve(valid(0))
    await disposal
  })

  it('contains stale automatic completion and DOMException provider cancellation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionBriefService, { ...CONFIG, automaticTriggers: ['turn-end'] })
    const pending = deferred<SessionBriefProviderResult>()
    let abortMode = false
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('automatic-stale'),
      generate() {
        return abortMode ? Promise.reject(new DOMException('cancelled', 'AbortError')) : pending.promise
      },
    })
    const stale = ctx.sessions.create(SessionId('brief-auto-active-stale'))
    stale.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    source(stale)
    pending.resolve(valid(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.sessionBrief.get(stale)).toBeUndefined()

    abortMode = true
    const cancelled = ctx.sessions.create(SessionId('brief-provider-dom-abort'))
    source(cancelled)
    expect(await ctx.sessionBrief.refresh(cancelled)).toEqual({ status: 'failed', reason: 'cancelled' })
  })

  it('contains a non-Error automatic provider rejection', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionBriefService, { ...CONFIG, automaticTriggers: ['turn-end'] })
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('automatic-non-error'),
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise content-free classification for arbitrary throws
      generate: () => Promise.reject('offline'),
    })
    const session = ctx.sessions.create(SessionId('brief-auto-non-error'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.sessionBrief.get(session)).toBeUndefined()
  })

  it('handles Session and service disposal before any work state or provider exists', async () => {
    const { ctx, fiber } = await service()
    let session!: Session
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create(SessionId('brief-dispose-no-state'))
    }, { inject: ['sessions'] }))
    await owner.dispose()
    expect(ctx.sessions.get(session.id)).toBeUndefined()
    await fiber.dispose()
  })

  it('aborts and drains provider work when the service fiber disposes', async () => {
    const { ctx, fiber } = await service()
    const pending = deferred<SessionBriefProviderResult>()
    let signal: AbortSignal | undefined
    ctx.sessionBrief.register({
      id: SessionBriefProviderId('service-disposal'),
      generate(request) {
        signal = request.signal
        return pending.promise
      },
    })
    const session = ctx.sessions.create(SessionId('brief-service-disposal'))
    source(session)
    const serviceRef = ctx.sessionBrief
    const refresh = serviceRef.refresh(session)
    await Promise.resolve()
    const disposal = fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(signal?.aborted).toBe(true)
    pending.resolve(valid(0))
    await disposal
    expect(await refresh).toEqual({ status: 'failed', reason: 'cancelled' })
    await expect(serviceRef.refresh(session)).rejects.toThrow(/service disposed/)
  })
})
