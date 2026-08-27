/**
 * Generated Session brief service, projection, and provider contract.
 * @module @deepseek-ai/dsh-session-brief
 */

import { Context, FiberState, Service, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { sessionActivityKindOf } from '@deepseek-ai/dsh-session-activity'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-telemetry'
import { createSessionBriefProjectionDefinition } from './projection.ts'
import type { SessionBriefEventData, SessionBriefModelProvenance } from './types.ts'

export type * from './types.ts'
export { createSessionBriefProjectionDefinition } from './projection.ts'

/** Identifies one Session brief provider registration. */
export type SessionBriefProviderId = Branded<'SessionBriefProviderId'>

/**
 * Brand a provider id.
 * @param id - stable non-empty provider identifier.
 * @returns the same string with the Session brief provider brand.
 */
export function SessionBriefProviderId(id: string): SessionBriefProviderId {
  return id as SessionBriefProviderId
}

/** Automatic generation checkpoints recognized by the coordinator. */
export type SessionBriefAutomaticTrigger = 'turn-end' | 'goal-blocked' | 'turn-error'

/** Required generation and accepted-value policy. */
export interface Config {
  /** Enabled automatic checkpoints; an empty array keeps generation manual. */
  readonly automaticTriggers: SessionBriefAutomaticTrigger[]
  /** Required meaningful-event advance after the previous accepted brief. */
  readonly minMeaningfulEvents: number
  /** Maximum UTF-8 bytes in one complete accepted brief. */
  readonly maxBriefBytes: number
  /** Maximum completed, blocker, and citation entries. */
  readonly maxItemsPerField: number
}

interface ResolvedConfig extends Omit<Config, 'automaticTriggers'> {
  readonly automaticTriggers: readonly SessionBriefAutomaticTrigger[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionBrief: SessionBriefService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete generated brief; log-only and safe for unaware readers to skip. */
    'session/brief': SessionBriefEventData
  }
}

/** Fixed Session revision supplied to one provider call. */
export interface SessionBriefProviderRequest {
  /** Live Session used only to append the provider's exact request record. */
  readonly session: Session
  /** Immutable Session header safe for the provider's selection policy. */
  readonly header: SessionHeader
  /** Frozen event snapshots through `sourceSeq`; later events are absent. */
  readonly events: readonly SessionEvent[]
  /** Latest meaningful event included in `events`. */
  readonly sourceSeq: number
  /** Service-owned output and citation limits for provider-side validation. */
  readonly limits: {
    readonly maxBriefBytes: number
    readonly maxItemsPerField: number
  }
  /** Previous accepted brief visible at reservation time. */
  readonly previous?: SessionBriefEventData | undefined
  /** Current logged main-request route, when available. */
  readonly route?: SessionBriefModelProvenance | undefined
  /** Cancellation for supersession, disposal, Agent maintenance, or the caller. */
  readonly signal: AbortSignal
}

/** Complete provider candidate before service-owned normalization and metadata. */
export interface SessionBriefProviderResult {
  /** Concise task statement. */
  readonly task: string
  /** Current objective. */
  readonly currentGoal?: string | undefined
  /** Current work focus. */
  readonly currentFocus?: string | undefined
  /** Completed-result summaries. */
  readonly completed: readonly string[]
  /** Most useful next action. */
  readonly nextStep?: string | undefined
  /** Unresolved blockers. */
  readonly blockers: readonly string[]
  /** User action currently required. */
  readonly waitingForUser?: string | undefined
  /** Ordered source event seqs selected from `request.events`. */
  readonly sourceEventSeqs: readonly number[]
  /** Exact auxiliary model route used for generation. */
  readonly model: SessionBriefModelProvenance
}

/** One optional asynchronous generated-brief implementation. */
export interface SessionBriefProvider {
  /** Stable registration identity. */
  readonly id: SessionBriefProviderId
  /**
   * Generate one complete candidate for a fixed source revision.
   * @param request - fixed event snapshot, route, previous brief, and cancellation.
   * @returns complete candidate with exact source citations and model route.
   */
  generate(request: SessionBriefProviderRequest): Promise<SessionBriefProviderResult>
}

/** Typed outcome of an explicit Session brief refresh. */
export type SessionBriefRefreshResult =
  | { readonly status: 'accepted'; readonly brief: SessionBriefEventData }
  | { readonly status: 'unavailable'; readonly reason: 'no-provider' | 'no-meaningful-events' }
  | { readonly status: 'busy' }
  | {
    readonly status: 'failed'
    readonly reason: 'cancelled' | 'stale' | 'invalid-result' | 'provider-failed'
    readonly code?: string | undefined
  }

interface ProviderRegistration {
  readonly provider: SessionBriefProvider
  readonly active: Set<Promise<unknown>>
  closing: boolean
}

interface ReservedWork {
  readonly registration: ProviderRegistration
  readonly revision: number
  readonly sourceSeq: number
}

interface ActiveWork extends ReservedWork {
  readonly controller: AbortController
  readonly signal: AbortSignal
}

interface SessionBriefWorkState {
  revision: number
  pending?: ReservedWork
  active?: ActiveWork
}

class SessionBriefStaleError extends Error {
  override readonly name = 'SessionBriefStaleError'
}

class SessionBriefValidationError extends Error {
  override readonly name = 'SessionBriefValidationError'
}

const AUTOMATIC_TRIGGERS = ['turn-end', 'goal-blocked', 'turn-error'] as const

function assertPositiveInteger(name: Exclude<keyof Config, 'automaticTriggers'>, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-brief: ${name} must be a positive integer`)
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function latestMeaningfulSeq(events: readonly SessionEvent[]): number | null {
  return events.findLast(event => sessionActivityKindOf(event) !== null)?.seq ?? null
}

function meaningfulAdvance(events: readonly SessionEvent[], afterSeq: number): number {
  let count = 0
  for (const event of events) {
    if (event.seq > afterSeq && sessionActivityKindOf(event) !== null) count += 1
  }
  return count
}

function triggerOf(event: SessionEvent): SessionBriefAutomaticTrigger | undefined {
  if (event.type === 'goal/change' && event.data.operation === 'block') return 'goal-blocked'
  if (event.type !== 'turn/end') return undefined
  return event.data.reason.kind === 'error' ? 'turn-error' : 'turn-end'
}

/** Log-backed generated brief coordinator. */
export class SessionBriefService extends Service {
  static inject = ['sessions']
  static Config: z<Config> = z.object({
    automaticTriggers: z.array(z.union(AUTOMATIC_TRIGGERS)).required(),
    minMeaningfulEvents: z.number().step(1).min(1).required(),
    maxBriefBytes: z.number().step(1).min(1).required(),
    maxItemsPerField: z.number().step(1).min(1).required(),
  })

  private readonly config: ResolvedConfig
  private readonly automaticTriggers: ReadonlySet<SessionBriefAutomaticTrigger>
  private readonly ownerFiber: Fiber
  private readonly lifetime = new AbortController()
  private readonly work = new Map<Session, SessionBriefWorkState>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private registration: ProviderRegistration | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionBrief')
    this.ownerFiber = ctx.fiber
    const candidate: unknown = config
    if (candidate === null || typeof candidate !== 'object') {
      throw new Error('session-brief: configuration is required')
    }
    const value = candidate as Config
    if (!Array.isArray(value.automaticTriggers)) throw new Error('session-brief: configuration is required')
    assertPositiveInteger('minMeaningfulEvents', value.minMeaningfulEvents)
    assertPositiveInteger('maxBriefBytes', value.maxBriefBytes)
    assertPositiveInteger('maxItemsPerField', value.maxItemsPerField)
    const automaticTriggers = [...value.automaticTriggers]
    if (new Set(automaticTriggers).size !== automaticTriggers.length
      || automaticTriggers.some(trigger => !AUTOMATIC_TRIGGERS.includes(trigger))) {
      throw new Error('session-brief: automaticTriggers must be a unique supported subset')
    }
    this.config = Object.freeze({ ...value, automaticTriggers: Object.freeze(automaticTriggers) })
    this.automaticTriggers = new Set(automaticTriggers)

    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('session-brief service disposed'))
      if (this.registration !== undefined) this.registration.closing = true
      this.registration = undefined
      for (const state of this.work.values()) {
        delete state.pending
        state.active?.controller.abort(new Error('session-brief service disposed'))
      }
      await this.drain(this.inFlight)
      this.work.clear()
    }, 'sessionBrief lifecycle')

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(createSessionBriefProjectionDefinition(this.config))
    })

    ctx.on('session-telemetry/record', (record, next) => {
      const forwarded = next()
      if (record.attributes['event.type'] !== 'session/brief') return forwarded
      const brief = record.body as SessionBriefEventData
      return {
        ...forwarded,
        body: {
          version: brief.version,
          revision: brief.revision,
          sourceSeq: brief.sourceSeq,
          generatedAt: brief.generatedAt,
          completedCount: brief.completed.length,
          blockerCount: brief.blockers.length,
          provider: brief.provenance.provider,
          model: brief.provenance.model,
          sourceEventSeqs: brief.provenance.sourceEventSeqs,
        },
      }
    }, { global: true })

    ctx.on('session/event', (session, event) => {
      if (sessionActivityKindOf(event) === null) return
      const state = this.work.get(session)
      const sourceSeq = event.seq
      if ((state?.pending !== undefined && state.pending.sourceSeq < sourceSeq)
        || (state?.active !== undefined && state.active.sourceSeq < sourceSeq)) {
        this.supersede(state, 'newer meaningful Session activity superseded brief generation')
      }
      const trigger = triggerOf(event)
      if (trigger !== undefined && this.automaticTriggers.has(trigger)) {
        this.scheduleAutomatic(session, sourceSeq)
      }
    })

    ctx.on('session/disposed', (session) => {
      const state = this.work.get(session)
      if (state === undefined) return
      state.active?.controller.abort(new Error('session disposed during brief generation'))
      this.work.delete(session)
    })
  }

  /**
   * Read the latest accepted brief from a live or replayed Session.
   * @param session - Session whose log is authoritative.
   * @returns latest complete brief, or `undefined` before acceptance.
   */
  get(session: Session): SessionBriefEventData | undefined {
    return session.events.findLast(event => event.type === 'session/brief')?.data
  }

  /**
   * Register the sole optional brief provider.
   * @param provider - stable provider identity and generation function.
   * @returns disposer that aborts and drains this registration's active calls.
   */
  register(provider: SessionBriefProvider): () => Promise<void> {
    this.validateProvider(provider)
    if (this.registration !== undefined) {
      throw new Error(`session-brief provider "${this.registration.provider.id}" is already registered`)
    }
    const registration: ProviderRegistration = { provider, active: new Set(), closing: false }
    return this.ctx.effect(function* (this: SessionBriefService) {
      this.registration = registration
      yield async () => {
        registration.closing = true
        for (const state of this.work.values()) {
          if (state.pending?.registration === registration) delete state.pending
          if (state.active?.registration === registration) {
            state.active.controller.abort(new Error(`session-brief provider "${provider.id}" was disposed`))
          }
        }
        await this.drain(registration.active)
        this.registration = undefined
      }
    }.bind(this), 'sessionBrief.register()')
  }

  /**
   * Generate one brief from the current stable meaningful revision.
   * @param session - exact live Session to refresh.
   * @param signal - optional caller cancellation.
   * @returns typed acceptance, capability absence, busy, or failure outcome.
   */
  async refresh(session: Session, signal?: AbortSignal): Promise<SessionBriefRefreshResult> {
    this.assertServiceActive()
    if (this.ctx.sessions.get(session.id) !== session) {
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    if (signal?.aborted === true) return { status: 'failed', reason: 'cancelled' }
    const registration = this.registration
    if (registration === undefined || registration.closing) {
      return { status: 'unavailable', reason: 'no-provider' }
    }
    const sourceSeq = latestMeaningfulSeq(session.events)
    if (sourceSeq === null) return { status: 'unavailable', reason: 'no-meaningful-events' }
    const state = this.stateFor(session)
    const agent = this.ctx.get('agents')?.get(session.id)
    if (state.active !== undefined || agent?.status === 'running') return { status: 'busy' }

    const revision = this.supersede(state, 'explicit brief refresh superseded older generation')
    const reserved: ReservedWork = { registration, revision, sourceSeq }
    if (agent === undefined) {
      return this.refreshOutcome(this.startProvider(session, this.activate(reserved, state, signal)), signal)
    }
    let run: Promise<SessionBriefEventData>
    try {
      run = agent.runMaintenance(maintenanceSignal => this.startProvider(
        session,
        this.activate(reserved, state, signal, maintenanceSignal),
      ))
    } catch {
      return { status: 'busy' }
    }
    return this.refreshOutcome(run, signal)
  }

  private scheduleAutomatic(session: Session, sourceSeq: number): void {
    const registration = this.registration
    if (registration === undefined || registration.closing) return
    const previousSourceSeq = this.get(session)?.sourceSeq ?? -1
    if (meaningfulAdvance(session.events, previousSourceSeq) < this.config.minMeaningfulEvents) return
    const state = this.stateFor(session)
    const revision = this.supersede(state, 'newer automatic brief trigger superseded older generation')
    const reserved: ReservedWork = { registration, revision, sourceSeq }
    state.pending = reserved
    this.defer(() => this.startAutomatic(session, state, reserved))
  }

  private async startAutomatic(
    session: Session,
    state: SessionBriefWorkState,
    reserved: ReservedWork,
  ): Promise<void> {
    const agent = this.ctx.get('agents')?.get(session.id)
    if (agent !== undefined) await agent.whenIdle()
    if (!this.reservedCurrent(session, state, reserved)) return
    try {
      let run: Promise<SessionBriefEventData>
      if (agent === undefined) {
        run = this.startProvider(session, this.activate(reserved, state))
      } else {
        try {
          run = agent.runMaintenance(maintenanceSignal => this.startProvider(
            session,
            this.activate(reserved, state, undefined, maintenanceSignal),
          ))
        } catch {
          return
        }
      }
      await run
    } catch (error: unknown) {
      if (error instanceof SessionBriefStaleError || this.lifetime.signal.aborted) return
      this.ctx.logger.warn(`session "${session.id}": automatic brief generation failed (${errorName(error)})`)
    }
  }

  private startProvider(session: Session, work: ActiveWork): Promise<SessionBriefEventData> {
    const run = Promise.resolve().then(() => this.runProvider(session, work))
    return this.track(run, work.registration)
  }

  private async runProvider(session: Session, work: ActiveWork): Promise<SessionBriefEventData> {
    try {
      this.assertCurrent(session, work)
      const events = session.events.filter(event => event.seq <= work.sourceSeq)
      const route = session.requestHeader()?.config
      const previous = this.get(session)
      const result = await work.registration.provider.generate({
        session,
        header: session.header,
        events,
        sourceSeq: work.sourceSeq,
        limits: {
          maxBriefBytes: this.config.maxBriefBytes,
          maxItemsPerField: this.config.maxItemsPerField,
        },
        ...(previous === undefined ? {} : { previous }),
        ...route === undefined ? {} : { route: { provider: route.provider, model: route.model } },
        signal: work.signal,
      })
      this.assertCurrent(session, work)
      const data = this.validateResult(result, work, events)
      session.append('session/brief', data, { ignorable: true })
      return data
    } finally {
      const state = this.work.get(session)
      if (state?.active === work) delete state.active
    }
  }

  private validateResult(
    result: unknown,
    work: ActiveWork,
    events: readonly SessionEvent[],
  ): SessionBriefEventData {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new SessionBriefValidationError('provider returned an invalid result')
    }
    const candidate = result as Record<string, unknown>
    const allowed = new Set([
      'task', 'currentGoal', 'currentFocus', 'completed', 'nextStep', 'blockers',
      'waitingForUser', 'sourceEventSeqs', 'model',
    ])
    if (Object.keys(candidate).some(key => !allowed.has(key))) {
      throw new SessionBriefValidationError('provider returned unknown fields')
    }
    const task = this.requiredText(candidate['task'], 'task')
    const completed = this.textArray(candidate['completed'], 'completed')
    const blockers = this.textArray(candidate['blockers'], 'blockers')
    const currentGoal = this.optionalText(candidate['currentGoal'], 'currentGoal')
    const currentFocus = this.optionalText(candidate['currentFocus'], 'currentFocus')
    const nextStep = this.optionalText(candidate['nextStep'], 'nextStep')
    const waitingForUser = this.optionalText(candidate['waitingForUser'], 'waitingForUser')
    const sourceEventSeqs = this.sourceEventSeqs(candidate['sourceEventSeqs'], work.sourceSeq, events)
    const model = this.model(candidate['model'])
    const data: SessionBriefEventData = {
      version: 1,
      revision: work.revision,
      sourceSeq: work.sourceSeq,
      generatedAt: Date.now(),
      task,
      ...(currentGoal === undefined ? {} : { currentGoal }),
      ...(currentFocus === undefined ? {} : { currentFocus }),
      completed,
      ...(nextStep === undefined ? {} : { nextStep }),
      blockers,
      ...(waitingForUser === undefined ? {} : { waitingForUser }),
      provenance: { ...model, sourceEventSeqs },
    }
    if (jsonBytes(data) > this.config.maxBriefBytes) {
      throw new SessionBriefValidationError('provider result exceeds maxBriefBytes')
    }
    return data
  }

  private requiredText(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new SessionBriefValidationError(`${field} must be a string`)
    const normalized = normalizeText(value)
    if (normalized.length === 0) throw new SessionBriefValidationError(`${field} must not be empty`)
    return normalized
  }

  private optionalText(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : this.requiredText(value, field)
  }

  private textArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length > this.config.maxItemsPerField) {
      throw new SessionBriefValidationError(`${field} exceeds its item limit or is not an array`)
    }
    const items = value.map(item => this.requiredText(item, `${field} item`))
    if (new Set(items).size !== items.length) {
      throw new SessionBriefValidationError(`${field} contains duplicate items`)
    }
    return items
  }

  private sourceEventSeqs(value: unknown, sourceSeq: number, events: readonly SessionEvent[]): number[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > this.config.maxItemsPerField) {
      throw new SessionBriefValidationError('sourceEventSeqs must be a bounded non-empty array')
    }
    const available = new Set(events.map(event => event.seq))
    const seqs: number[] = []
    let previous = -1
    for (const seq of value as unknown[]) {
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0
        || seq <= previous || seq > sourceSeq || !available.has(seq)) {
        throw new SessionBriefValidationError('sourceEventSeqs must be ordered source seqs from the request')
      }
      seqs.push(seq)
      previous = seq
    }
    return seqs
  }

  private model(value: unknown): SessionBriefModelProvenance {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new SessionBriefValidationError('model provenance is invalid')
    }
    const model = value as Record<string, unknown>
    if (Object.keys(model).some(key => key !== 'provider' && key !== 'model')
      || typeof model['provider'] !== 'string' || normalizeText(model['provider']).length === 0
      || typeof model['model'] !== 'string' || normalizeText(model['model']).length === 0) {
      throw new SessionBriefValidationError('model provenance is invalid')
    }
    return { provider: normalizeText(model['provider']), model: normalizeText(model['model']) }
  }

  private async refreshOutcome(
    run: Promise<SessionBriefEventData>,
    callerSignal?: AbortSignal,
  ): Promise<SessionBriefRefreshResult> {
    try {
      return { status: 'accepted', brief: await run }
    } catch (error: unknown) {
      if (callerSignal?.aborted === true) return { status: 'failed', reason: 'cancelled' }
      if (error instanceof SessionBriefValidationError) return { status: 'failed', reason: 'invalid-result' }
      if (error instanceof SessionBriefStaleError) return { status: 'failed', reason: 'stale' }
      if (isAbort(error)) return { status: 'failed', reason: 'cancelled' }
      const code = error !== null && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : undefined
      return {
        status: 'failed',
        reason: 'provider-failed',
        ...(typeof code === 'string' && code.length > 0 ? { code } : {}),
      }
    }
  }

  private assertCurrent(session: Session, work: ActiveWork): void {
    this.assertServiceActive()
    if (work.signal.aborted) throw work.signal.reason
    const state = this.work.get(session)
    /* v8 ignore next 3 -- every supported supersession and disposal aborts the work signal before changing this state */
    if (this.registration !== work.registration || state?.active !== work
      || state.revision !== work.revision || this.ctx.sessions.get(session.id) !== session) {
      throw new SessionBriefStaleError('brief generation is no longer current')
    }
  }

  private activate(
    reserved: ReservedWork,
    state: SessionBriefWorkState,
    callerSignal?: AbortSignal,
    maintenanceSignal?: AbortSignal,
  ): ActiveWork {
    const controller = new AbortController()
    const signals = [controller.signal, this.lifetime.signal]
    if (callerSignal !== undefined) signals.push(callerSignal)
    if (maintenanceSignal !== undefined) signals.push(maintenanceSignal)
    const work: ActiveWork = { ...reserved, controller, signal: AbortSignal.any(signals) }
    if (state.pending === reserved) delete state.pending
    state.active = work
    return work
  }

  private supersede(state: SessionBriefWorkState, reason: string): number {
    state.active?.controller.abort(new SessionBriefStaleError(reason))
    delete state.pending
    state.revision += 1
    return state.revision
  }

  private stateFor(session: Session): SessionBriefWorkState {
    let state = this.work.get(session)
    if (state === undefined) {
      state = { revision: this.get(session)?.revision ?? 0 }
      this.work.set(session, state)
    }
    return state
  }

  private reservedCurrent(
    session: Session,
    state: SessionBriefWorkState,
    reserved: ReservedWork,
  ): boolean {
    return this.serviceActive() && this.registration === reserved.registration
      && !reserved.registration.closing && this.work.get(session) === state
      && state.pending === reserved && state.revision === reserved.revision
      && this.ctx.sessions.get(session.id) === session
      && latestMeaningfulSeq(session.events) === reserved.sourceSeq
  }

  private validateProvider(provider: unknown): asserts provider is SessionBriefProvider {
    if (provider === null || typeof provider !== 'object') {
      throw new Error('session-brief provider must be an object')
    }
    const candidate = provider as Record<string, unknown>
    if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) {
      throw new Error('session-brief provider id must be a non-empty string')
    }
    if (typeof candidate['generate'] !== 'function') {
      throw new Error(`session-brief provider "${candidate['id']}" requires generate()`)
    }
  }

  private defer(task: () => Promise<void>): void {
    const run = Promise.resolve().then(async () => {
      /* v8 ignore next -- lifecycle teardown removes event sources before this queued callback can observe an inactive owner */
      if (this.serviceActive()) await task()
    })
    void this.track(run)
  }

  private track<T>(run: Promise<T>, registration?: ProviderRegistration): Promise<T> {
    this.inFlight.add(run)
    registration?.active.add(run)
    const settled = (): void => {
      this.inFlight.delete(run)
      registration?.active.delete(run)
    }
    void run.then(settled, settled)
    return run
  }

  private async drain(active: Set<Promise<unknown>>): Promise<void> {
    while (active.size > 0) await Promise.allSettled([...active])
  }

  private serviceActive(): boolean {
    return !this.lifetime.signal.aborted
      /* v8 ignore next 2 -- fiber teardown may mark inactive before lifecycle effects run */
      && this.ownerFiber.uid !== null
      && this.ownerFiber.state === FiberState.ACTIVE
  }

  private assertServiceActive(): void {
    if (!this.serviceActive()) throw new Error('session-brief service disposed')
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /abort|supersed|disposed/i.test(error.message)
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export default SessionBriefService
