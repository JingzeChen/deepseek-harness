/**
 * Client-safe types for the generated `sessionBrief` projection.
 * @module @deepseek-ai/dsh-session-brief/types
 */

export {}

/** Exact auxiliary model route that produced a Session brief. */
export interface SessionBriefModelProvenance {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
}

/** Durable provenance for one accepted generated brief. */
export interface SessionBriefProvenance extends SessionBriefModelProvenance {
  /** Ordered, unique source event sequences cited by the provider. */
  readonly sourceEventSeqs: number[]
}

/** Complete payload of the log-only `session/brief` event. */
export interface SessionBriefEventData {
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

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionBrief: SessionBriefEventData | null
  }
  interface SessionProjectionMap {
    /** Latest complete generated brief, or `null` before one is accepted. */
    sessionBrief: SessionBriefEventData | null
  }
}
