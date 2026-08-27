/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-session-overview`.
 * @module @deepseek-ai/dsh-client-ui-session-overview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-session-overview'

/** Cordis companion plugin name. */
export const name = 'client-ui-session-overview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package derives rows from object-layer snapshots,
 * mutates only its framework store, and proves both slot registrations remove
 * on plugin disposal through its registration test.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
