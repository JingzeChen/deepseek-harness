# 会话摘要

[English](session-brief.md) | 中文

由 [`@deepseek-ai/dsh-session-brief`](../../packages/session/session-brief) 拥有的有界生成式恢复工作摘要，以及由 [`@deepseek-ai/dsh-session-brief-llm`](../../packages/session/session-brief-llm) 提供的结构化模型生成。各包 README 负责时序、配置、选择、失败和隐私行为；生成的[持久化日志事件目录](../persistence-catalog.zh.md)负责完整事件声明。

源码：[`packages/session/session-brief/src/index.ts`](../../packages/session/session-brief/src/index.ts)、[`packages/session/session-brief/src/types.ts`](../../packages/session/session-brief/src/types.ts)、[`packages/session/session-brief-llm/src/index.ts`](../../packages/session/session-brief-llm/src/index.ts)

## 持久值

`SessionBriefEventData` 是完整的 schema version 1 值。`revision` 随服务接纳的 reservation 递增，`sourceSeq` 固定摘要覆盖的最新有意义事件，`generatedAt` 记录接纳时间。任务、目标、重点、已完成项、下一步、阻塞项和等待用户文本是模型解释；确定性的 Goal、Todo、活动、交互和 Agent 状态仍是权威来源。

`provenance` 携带精确的辅助 provider/model 路由，以及有序且唯一的来源事件 seq。引用非空、不超过 `sourceSeq`，并标识固定 provider 请求中的事件。`sessionBrief` 投影以 `null` 开始，把 `session/brief` 作为完整的后写覆盖值应用。

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

## Provider 与刷新

`SessionBriefProviderRequest` 包含截至固定 `sourceSeq` 的不可变事件、会话 header、上一份已接纳摘要、可用时已记录的主路由、接纳值限制和取消信号。`SessionBriefProviderResult` 包含全部解释字段、精确引用和实际使用的辅助路由。

显式刷新区分已接纳、provider 或来源缺失、Agent/refresh busy、取消、陈旧 revision、无效输出和 provider 失败。存在 live Agent 时，生成会被保留为 maintenance；automatic trigger 配置可在 Agent idle 后调度同一操作。新的有意义活动和每个 owner 的卸载都会在 append 前阻止陈旧完成。

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

## 辅助审计记录

`session/brief-llm-request` 在模型调用前记录精确且可分发的系统指令、messages、选定来源 seq、路由、schema version 和输出 token 上限。`session/brief-llm-result` 关联该请求，并记录路由、来源 revision、耗时、结果、可选 provider token usage 和不含内容的错误 code。

三个事件都携带 `ignorable: true`，只存在于日志中，绝不会进入 `deriveMessages()`。Telemetry 把规范记录保留在本地，同时只导出生成摘要和精确请求的元数据形式。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.zh.md)

Source: [`packages/session/session-brief/src/index.ts`](../../packages/session/session-brief/src/index.ts)
<!-- END GENERATED cordis-surface -->