/**
 * Last-wins projection for complete generated Session briefs.
 * @module @deepseek-ai/dsh-session-brief/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionBriefEventData } from './types.ts'

/** Bounds captured by one Session brief projection definition. */
export interface SessionBriefProjectionConfig {
  /** Maximum UTF-8 bytes in one complete brief value. */
  readonly maxBriefBytes: number
  /** Maximum entries in completed, blocker, and citation arrays. */
  readonly maxItemsPerField: number
}

type SessionBriefProjectionDefinition =
  Omit<ProjectionDefinition<'sessionBrief', SessionBriefEventData | null>, 'wire'> & {
    wire: NonNullable<ProjectionDefinition<'sessionBrief', SessionBriefEventData | null>['wire']>
  }

/** Return the UTF-8 byte length of a JSON-compatible value. */
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Whether citations are strictly increasing and do not exceed the fixed source revision. */
function validCitations(value: SessionBriefEventData): boolean {
  let previous = -1
  for (const seq of value.provenance.sourceEventSeqs) {
    if (seq <= previous || seq > value.sourceSeq) return false
    previous = seq
  }
  return true
}

/**
 * Build the strict last-wins projection for configured accepted-value bounds.
 * @param config - complete-value and per-array limits.
 * @returns projection definition suitable for `ctx.sessionProjections.register()`.
 */
export function createSessionBriefProjectionDefinition(
  config: SessionBriefProjectionConfig,
): SessionBriefProjectionDefinition {
  const text = z.string().min(1)
  const itemArray = z.array(text).max(config.maxItemsPerField)
  const model = z.object({
    provider: text,
    model: text,
    sourceEventSeqs: z.array(z.number().int().nonnegative()).min(1).max(config.maxItemsPerField),
  }).strict()
  const brief = z.object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    sourceSeq: z.number().int().nonnegative(),
    generatedAt: z.number().int().nonnegative(),
    task: text,
    currentGoal: text.optional(),
    currentFocus: text.optional(),
    completed: itemArray,
    nextStep: text.optional(),
    blockers: itemArray,
    waitingForUser: text.optional(),
    provenance: model,
  }).strict().refine(validCitations, {
    message: 'sourceEventSeqs must be ordered, unique, and no later than sourceSeq',
  }).refine(value => jsonBytes(value) <= config.maxBriefBytes, {
    message: `sessionBrief exceeds maxBriefBytes ${String(config.maxBriefBytes)}`,
  })
  const nullableBrief = brief.nullable()
  return {
    key: 'sessionBrief',
    stateVersion: 1,
    stateSchema: nullableBrief,
    init: () => null,
    apply: (state, event) => event.type === 'session/brief' ? event.data : state,
    wire: {
      viewSchema: nullableBrief,
      view: state => state,
    },
  }
}
