/**
 * Invariant companion for the Session brief command Consumer.
 * @module @deepseek-ai/dsh-command-session-brief/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-session-brief'

/** Cordis companion plugin name. */
export const name = 'command-session-brief-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

// No runtime invariant: command lifecycle pairing belongs to `dsh-commands`; this Consumer adds no durable relationship.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
