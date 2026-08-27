/**
 * Package-owned invariant companion for Session brief LLM records.
 * @module @deepseek-ai/dsh-session-brief-llm/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-brief-llm'

/** Cordis companion plugin name. */
export const name = 'session-brief-llm-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type === 'session/brief-llm-request') {
      const seqs = event.data.selectedEventSeqs
      if (event.ignorable !== true || event.data.sourceSeq >= event.seq || seqs.length === 0
        || seqs.some(seq => seq > event.data.sourceSeq || session.events[seq]?.seq !== seq)
        || seqs.some((seq, index) => {
          const previous = seqs[index - 1]
          return index > 0 && (previous === undefined || previous >= seq)
        })) {
        fail(`session/brief-llm-request event ${String(event.seq)} must be ignorable and cite ordered existing sources through an earlier sourceSeq`)
      }
    }
    if (event.type === 'session/brief-llm-result') {
      const request = session.events[event.data.requestEventSeq]
      if (event.ignorable !== true || request?.type !== 'session/brief-llm-request'
        || request.data.sourceSeq !== event.data.sourceSeq) {
        fail(`session/brief-llm-result event ${String(event.seq)} must be ignorable and cite its matching request`)
      }
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
