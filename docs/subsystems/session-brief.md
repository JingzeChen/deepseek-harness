# Session Briefs

English | [中文](session-brief.zh.md)

Bounded generated catch-up values owned by [`@deepseek-ai/dsh-session-brief`](../../packages/session/session-brief), with structured model generation from [`@deepseek-ai/dsh-session-brief-llm`](../../packages/session/session-brief-llm). Package READMEs own timing, configuration, selection, failure, and privacy behavior; the generated [persistence catalog](../persistence-catalog.md) owns complete event declarations.

Sources: [`packages/session/session-brief/src/index.ts`](../../packages/session/session-brief/src/index.ts), [`packages/session/session-brief/src/types.ts`](../../packages/session/session-brief/src/types.ts), [`packages/session/session-brief-llm/src/index.ts`](../../packages/session/session-brief-llm/src/index.ts)

## Durable value

`SessionBriefEventData` is a complete schema-version-1 value. `revision` increases for accepted service reservations, `sourceSeq` fixes the latest meaningful event covered, and `generatedAt` records acceptance time. Task, goal, focus, completed items, next step, blockers, and user-wait text are model interpretations; deterministic Goal, Todo, activity, interaction, and Agent status remain authoritative.

`provenance` carries the exact auxiliary provider/model route and ordered, unique source-event seqs. Citations are non-empty, do not exceed `sourceSeq`, and identify events in the fixed provider request. The `sessionBrief` projection starts at `null` and applies `session/brief` as a complete last-wins value.

```ts type-equiv
/** Exact auxiliary model route that produced a Session brief. */
interface SessionBriefModelProvenance {
	/** Registered LLM provider route. */
	readonly provider: string
	/** Provider model id. */
	readonly model: string
}
```

```ts type-equiv
/** Durable provenance for one accepted generated brief. */
interface SessionBriefProvenance extends SessionBriefModelProvenance {
	/** Ordered, unique source event sequences cited by the provider. */
	readonly sourceEventSeqs: number[]
}
```

```ts type-equiv
/** Complete payload of the log-only `session/brief` event. */
interface SessionBriefEventData {
	/** Brief schema version. */
	readonly version: 1
	/** Monotonic service-owned generation revision within the Session. */
	readonly revision: number
	/** Latest meaningful event sequence covered by this brief. */
	readonly sourceSeq: number
	/** Epoch milliseconds when the accepted candidate completed. */
	readonly generatedAt: number
	/** Concise statement of the Session task. */
	readonly task: string
	/** Current objective interpreted from selected source facts. */
	readonly currentGoal?: string | undefined
	/** Work currently in progress. */
	readonly currentFocus?: string | undefined
	/** Bounded completed-result summaries. */
	readonly completed: string[]
	/** Most useful next action. */
	readonly nextStep?: string | undefined
	/** Bounded unresolved blockers. */
	readonly blockers: string[]
	/** Action or answer currently required from the user. */
	readonly waitingForUser?: string | undefined
	/** Model route and exact source citations. */
	readonly provenance: SessionBriefProvenance
}
```

## Provider and refresh

`SessionBriefProviderRequest` contains immutable events through one `sourceSeq`, the Session header, the preceding accepted brief, the logged main route when available, accepted-value limits, and cancellation. `SessionBriefProviderResult` contains every interpreted field, exact citations, and the used auxiliary route.

Explicit refresh distinguishes accepted, provider or source absence, busy Agent/refresh state, cancellation, stale revision, invalid output, and provider failure. A live Agent reserves generation as maintenance; automatic trigger configuration may schedule the same operation after idle. New meaningful activity and every owner disposal fence completion before append.

```ts type-equiv
/** Fixed Session revision supplied to one provider call. */
interface SessionBriefProviderRequest {
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
```

```ts type-equiv
/** Complete provider candidate before service-owned normalization and metadata. */
interface SessionBriefProviderResult {
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
```

```ts type-equiv
/** One optional asynchronous generated-brief implementation. */
interface SessionBriefProvider {
	/** Stable registration identity. */
	readonly id: SessionBriefProviderId
	/**
	 * Generate one complete candidate for a fixed source revision.
	 * @param request - fixed event snapshot, route, previous brief, and cancellation.
	 * @returns complete candidate with exact source citations and model route.
	 */
	generate(request: SessionBriefProviderRequest): Promise<SessionBriefProviderResult>
}
```

```ts type-equiv
/** Typed outcome of an explicit Session brief refresh. */
type SessionBriefRefreshResult =
	| { readonly status: 'accepted'; readonly brief: SessionBriefEventData }
	| { readonly status: 'unavailable'; readonly reason: 'no-provider' | 'no-meaningful-events' }
	| { readonly status: 'busy' }
	| {
		readonly status: 'failed'
		readonly reason: 'cancelled' | 'stale' | 'invalid-result' | 'provider-failed'
		readonly code?: string | undefined
	}
```

## Auxiliary audit records

`session/brief-llm-request` records the exact dispatchable system instruction, messages, selected source seqs, route, schema version, and output-token limit before the model call. `session/brief-llm-result` links to that request and records route, source revision, duration, outcome, optional provider token usage, and a content-free error code.

All three events carry `ignorable: true`, are log-only, and never enter `deriveMessages()`. Telemetry keeps the canonical records local while exporting metadata-only forms for the generated brief and exact request.

```ts type-equiv
/** Exact model-visible request recorded before one auxiliary dispatch. */
interface SessionBriefLlmRequestEventData {
	/** Registered brief-provider identity responsible for the request. */
	readonly briefProvider: SessionBriefProviderId
	/** Fixed meaningful source revision. */
	readonly sourceSeq: number
	/** Exact event seqs represented in the framed input. */
	readonly selectedEventSeqs: number[]
	/** Exact auxiliary LLM route. */
	readonly route: SessionBriefModelProvenance
	/** Structured-output schema version requested from the model. */
	readonly schemaVersion: 1
	/** Exact auxiliary system instruction. */
	readonly system: string
	/** Exact auxiliary message list. */
	readonly messages: Message[]
	/** Exact auxiliary output-token cap. */
	readonly maxTokens: number
}
```

```ts type-equiv
/** Content-free accounting for one dispatched auxiliary request. */
interface SessionBriefLlmResultEventData {
	/** Seq of the matching `session/brief-llm-request`. */
	readonly requestEventSeq: number
	/** Fixed meaningful source revision. */
	readonly sourceSeq: number
	/** Exact auxiliary LLM route. */
	readonly route: SessionBriefModelProvenance
	/** Wall time from dispatch start through terminal handling. */
	readonly durationMs: number
	/** Whether a schema-valid candidate was produced. */
	readonly outcome: 'generated' | 'failed'
	/** Provider-reported token accounting, when available. */
	readonly usage?: TokenUsage | undefined
	/** Content-free error classification for a failed request. */
	readonly errorCode?: string | undefined
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionbrief--sessionbriefservice"></a>

### `ctx.sessionBrief` — `SessionBriefService`

Log-backed generated brief coordinator.

```ts cordis-catalog
/**
 * Read the latest accepted brief from a live or replayed Session.
 * @param session - Session whose log is authoritative.
 * @returns latest complete brief, or `undefined` before acceptance.
 */
get(session: Session): SessionBriefEventData | undefined

/**
 * Register the sole optional brief provider.
 * @param provider - stable provider identity and generation function.
 * @returns disposer that aborts and drains this registration's active calls.
 */
register(provider: SessionBriefProvider): () => Promise<void>

/**
 * Generate one brief from the current stable meaningful revision.
 * @param session - exact live Session to refresh.
 * @param signal - optional caller cancellation.
 * @returns typed acceptance, capability absence, busy, or failure outcome.
 */
async refresh(session: Session, signal?: AbortSignal): Promise<SessionBriefRefreshResult>
```

Types: [Session](session.md)

Source: [`packages/session/session-brief/src/index.ts`](../../packages/session/session-brief/src/index.ts)
<!-- END GENERATED cordis-surface -->