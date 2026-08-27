/**
 * Package-owned invariant companion for generated Session briefs.
 * @module @deepseek-ai/dsh-session-brief/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-brief'

/** Cordis companion plugin name. */
export const name = 'session-brief-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'session/brief') return
    const previous = session.events.findLast(item => item.type === 'session/brief')
    const citations = event.data.provenance.sourceEventSeqs
    const sourceExists = session.events[event.data.sourceSeq]?.seq === event.data.sourceSeq
    if (event.ignorable !== true || event.data.sourceSeq >= event.seq || !sourceExists
      || citations.length === 0 || citations.some(seq => seq > event.data.sourceSeq || session.events[seq]?.seq !== seq)
      || citations.some((seq, index) => {
        const previous = citations[index - 1]
        return index > 0 && (previous === undefined || previous >= seq)
      })
      || (previous !== undefined && event.data.revision <= previous.data.revision)) {
      fail(`session/brief event ${String(event.seq)} must be ignorable, cite existing ordered sources through an earlier sourceSeq, and advance revision`)
    }
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
