/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-activity`.
 * @module @deepseek-ai/dsh-session-activity/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-activity'

/** Cordis companion plugin name. */
export const name = 'session-activity-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the projection registry validates every restored state
 * and emitted value, while Session, Agent Loop, Goal, Workflow, and Compaction
 * own the event relationships consumed by this pure fold.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
