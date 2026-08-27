/**
 * Function plugin registering the bounded `sessionActivity` projection.
 * @module @deepseek-ai/dsh-session-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createSessionActivityProjectionDefinition } from './projection.ts'

export type * from './types.ts'
export { createSessionActivityProjectionDefinition, sessionActivityKindOf } from './projection.ts'

/** Deployment-owned projection bounds. */
export interface Config {
  /** Maximum unmatched calls included in the client value. */
  maxOpenTools: number
  /** Maximum UTF-8 bytes exposed from an error's provider-neutral code. */
  maxErrorBytes: number
}

/** Strict plugin configuration schema. */
export const Config: z<Config> = z.object({
  maxOpenTools: z.natural().min(1).required(),
  maxErrorBytes: z.natural().min(1).required(),
})

/** Cordis plugin name. */
export const name = 'session-activity'
/** The projection registry drives and serves this package's fold. */
export const inject = ['sessionProjections']

/**
 * Register the configured projection definition for this plugin fiber.
 * @param ctx - context carrying the projection registry.
 * @param config - explicit wire bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(createSessionActivityProjectionDefinition(config))
}
