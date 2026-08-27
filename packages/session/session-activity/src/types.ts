/**
 * Client-safe types for the bounded `sessionActivity` projection.
 * @module @deepseek-ai/dsh-session-activity/types
 */

export {}

/** Durable activity category attached to the latest meaningful event. */
export type SessionActivityKind =
  | 'message'
  | 'tool'
  | 'turn'
  | 'goal'
  | 'todo'
  | 'workflow'
  | 'compaction'
  | 'subagent'

/** Known terminal reason for the latest closed Turn. */
export type SessionActivityTurnReason =
  | 'completed'
  | 'aborted'
  | 'blocked'
  | 'error'
  | 'max-tokens'
  | 'interrupted'

/** Bounded facts for the latest closed Turn. */
export interface SessionActivityLastTurn {
  /** Host-assigned Turn number. */
  turn: number
  /** Sequence of the `turn/end` event. */
  seq: number
  /** Epoch milliseconds carried by the `turn/end` event. */
  endedAt: number
  /** Known core terminal reason. */
  reason: SessionActivityTurnReason
  /** Bounded provider-neutral code for an error outcome. */
  errorCode?: string | undefined
}

/** One unmatched tool call safe for cross-Session display. */
export interface SessionActivityOpenTool {
  /** Model-issued call identity used for durable pairing. */
  callId: string
  /** Registered tool name; arguments and results are deliberately absent. */
  name: string
  /** Epoch milliseconds carried by the `tool/call` event. */
  startedAt: number
}

/** Bounded deterministic activity read model for one Session. */
export interface SessionActivityProjection {
  /** Sequence of the latest meaningful event, or `null` for an empty or ignored log. */
  lastMeaningfulSeq: number | null
  /** Epoch milliseconds of the latest meaningful event. */
  lastMeaningfulAt: number | null
  /** Category of the latest meaningful event. */
  lastKind: SessionActivityKind | null
  /** Latest closed Turn when its reason belongs to the known core vocabulary. */
  lastTurn?: SessionActivityLastTurn | undefined
  /** Earliest unmatched tool calls in model order, capped by plugin configuration. */
  openTools: SessionActivityOpenTool[]
  /** Additional unmatched calls omitted from `openTools`. */
  openToolsOmitted: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Bounded latest activity, Turn outcome, and unmatched tool calls. */
    sessionActivity: SessionActivityProjection
  }
}
