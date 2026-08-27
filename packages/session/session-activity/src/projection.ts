/**
 * Pure fold for the bounded `sessionActivity` projection.
 * @module @deepseek-ai/dsh-session-activity/projection
 */

import { z } from 'zod'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import type {
  SessionActivityKind,
  SessionActivityLastTurn,
  SessionActivityOpenTool,
} from './types.ts'

interface PendingTool extends SessionActivityOpenTool {
  turn: number
}

interface SessionActivityState {
  lastMeaningfulSeq: number | null
  lastMeaningfulAt: number | null
  lastKind: SessionActivityKind | null
  lastTurn: SessionActivityLastTurn | null
  pendingTools: PendingTool[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionActivity: SessionActivityState
  }
}

/** Explicit wire bounds captured by one projection definition. */
export interface SessionActivityProjectionConfig {
  /** Maximum unmatched calls included in the client value. */
  maxOpenTools: number
  /** Maximum UTF-8 bytes exposed from an error's provider-neutral code. */
  maxErrorBytes: number
}

type SessionActivityProjectionDefinition =
  Omit<ProjectionDefinition<'sessionActivity', SessionActivityState>, 'wire'> & {
    wire: NonNullable<ProjectionDefinition<'sessionActivity', SessionActivityState>['wire']>
  }

const openToolSchema = z.object({
  callId: z.string(),
  name: z.string(),
  startedAt: z.number().nonnegative(),
}).strict()

const lastTurnSchema = z.object({
  turn: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  endedAt: z.number().nonnegative(),
  reason: z.enum(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted']),
  errorCode: z.string().optional(),
}).strict()

const sessionActivitySchema = z.object({
  lastMeaningfulSeq: z.number().int().nonnegative().nullable(),
  lastMeaningfulAt: z.number().nonnegative().nullable(),
  lastKind: z.enum(['message', 'tool', 'turn', 'goal', 'todo', 'workflow', 'compaction', 'subagent']).nullable(),
  lastTurn: lastTurnSchema.optional(),
  openTools: z.array(openToolSchema),
  openToolsOmitted: z.number().int().nonnegative(),
}).strict()

const sessionActivityStateSchema = sessionActivitySchema
  .omit({ openTools: true, openToolsOmitted: true })
  .extend({
    lastTurn: lastTurnSchema.nullable(),
    pendingTools: z.array(openToolSchema.extend({ turn: z.number().int().nonnegative() })),
  })

function markMeaningful(
  state: SessionActivityState,
  event: { seq: number; time: number },
  lastKind: SessionActivityKind,
): SessionActivityState {
  return {
    ...state,
    lastMeaningfulSeq: event.seq,
    lastMeaningfulAt: event.time,
    lastKind,
  }
}

/**
 * Classify one event using the activity projection's meaningful-event rules.
 * @param event - durable Session event to classify.
 * @returns its activity category, or `null` when it does not advance activity.
 */
export function sessionActivityKindOf(event: SessionEvent): SessionActivityKind | null {
  switch (event.type) {
    case 'user/message':
    case 'assistant/message':
      return 'message'
    case 'tool/call':
    case 'tool/result':
      return 'tool'
    case 'turn/end':
      return 'turn'
    case 'goal/change':
      return 'goal'
    case 'todo/write':
      return 'todo'
    case 'tool-workflow/run-start':
    case 'tool-workflow/agent-start':
    case 'tool-workflow/agent-end':
    case 'tool-workflow/run-end':
      return 'workflow'
    case 'compaction/end':
      return event.data.error === undefined ? 'compaction' : null
    default:
      return null
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0
  let result = ''
  for (const character of value) {
    const size = new TextEncoder().encode(character).byteLength
    if (bytes + size > maxBytes) break
    bytes += size
    result += character
  }
  return result
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedLastTurn(
  lastTurn: SessionActivityLastTurn,
  maxErrorBytes: number,
): SessionActivityLastTurn {
  if (lastTurn.reason !== 'error' || lastTurn.errorCode === undefined) return lastTurn
  const errorCode = truncateUtf8(lastTurn.errorCode, maxErrorBytes)
  return {
    turn: lastTurn.turn,
    seq: lastTurn.seq,
    endedAt: lastTurn.endedAt,
    reason: lastTurn.reason,
    ...(errorCode === '' ? {} : { errorCode }),
  }
}

function knownTurn(
  turn: number,
  seq: number,
  endedAt: number,
  reason: TurnEndReason,
  maxErrorBytes: number,
): SessionActivityLastTurn | null {
  switch (reason.kind) {
    case 'completed':
    case 'aborted':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      return { turn, seq, endedAt, reason: reason.kind }
    case 'error': {
      const errorCode = truncateUtf8(reason.error.code, maxErrorBytes)
      return {
        turn,
        seq,
        endedAt,
        reason: 'error',
        ...(errorCode === '' ? {} : { errorCode }),
      }
    }
    default:
      return null
  }
}

/**
 * Build the projection definition for one explicit deployment configuration.
 * @param config - wire bounds supplied by the composing plugin.
 * @returns the pure projection definition.
 */
export function createSessionActivityProjectionDefinition(
  config: SessionActivityProjectionConfig,
): SessionActivityProjectionDefinition {
  const boundedStateSchema = sessionActivityStateSchema.refine(
    state => state.lastTurn?.errorCode === undefined
      || utf8Bytes(state.lastTurn.errorCode) <= config.maxErrorBytes,
    { message: `lastTurn.errorCode exceeds maxErrorBytes ${String(config.maxErrorBytes)}` },
  )
  const boundedViewSchema = sessionActivitySchema.refine(
    value => value.openTools.length <= config.maxOpenTools
      && (value.lastTurn?.errorCode === undefined
        || utf8Bytes(value.lastTurn.errorCode) <= config.maxErrorBytes),
    { message: 'sessionActivity value exceeds configured wire bounds' },
  )
  return {
    key: 'sessionActivity',
    stateVersion: 1,
    stateSchema: boundedStateSchema,
    init: () => ({
      lastMeaningfulSeq: null,
      lastMeaningfulAt: null,
      lastKind: null,
      lastTurn: null,
      pendingTools: [],
    }),
    apply: (state, event) => {
      switch (event.type) {
        case 'tool/call':
          return {
            ...markMeaningful(state, event, 'tool'),
            pendingTools: [...state.pendingTools, {
              turn: event.data.turn,
              callId: event.data.callId,
              name: event.data.name,
              startedAt: event.time,
            }],
          }
        case 'tool/result': {
          const callId = event.data.message.source.callId
          return {
            ...markMeaningful(state, event, 'tool'),
            pendingTools: state.pendingTools.filter(tool => tool.callId !== callId),
          }
        }
        case 'turn/end':
          return {
            ...markMeaningful(state, event, 'turn'),
            lastTurn: knownTurn(event.data.turn, event.seq, event.time, event.data.reason, config.maxErrorBytes),
            pendingTools: state.pendingTools.filter(tool => tool.turn !== event.data.turn),
          }
        default: {
          const kind = sessionActivityKindOf(event)
          return kind === null ? state : markMeaningful(state, event, kind)
        }
      }
    },
    wire: {
      viewSchema: boundedViewSchema,
      view: state => ({
        lastMeaningfulSeq: state.lastMeaningfulSeq,
        lastMeaningfulAt: state.lastMeaningfulAt,
        lastKind: state.lastKind,
        ...(state.lastTurn === null ? {} : { lastTurn: boundedLastTurn(state.lastTurn, config.maxErrorBytes) }),
        openTools: state.pendingTools.slice(0, config.maxOpenTools).map(({ callId, name, startedAt }) => ({
          callId,
          name,
          startedAt,
        })),
        openToolsOmitted: Math.max(0, state.pendingTools.length - config.maxOpenTools),
      }),
    },
  }
}
