/** Browser plugin registering the Session activity beacon, workbench, and Context view. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  OverviewWorkbench,
  type OverviewInteractionResponse,
  type OverviewWorkbenchInjected,
} from './OverviewWorkbench.tsx'
import { ContextView } from './ContextView.tsx'
import { en, NS, zh } from './locales.ts'
import { createSessionOverviewViewStore } from './stores.ts'

export type { SessionOverviewKey } from './locales.ts'

/** Services required for Session/Workspace actions, slots, and localization. */
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'remote.commands', 'locale']

/**
 * Register the shared-store beacon/workbench and Session Context view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const store = createSessionOverviewViewStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-overview: dictionaries')

  const injected = (): OverviewWorkbenchInjected => ({
    openSession: (sessionId: SessionId) => { ctx.sessions.open(sessionId) },
    cancelSession: async (sessionId: SessionId) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.cancel()
      if (!result.ok) throw new Error(result.error.message)
    },
    archiveSession: async (sessionId: SessionId) => {
      await ctx.workspaces.archiveSession(sessionId)
    },
    respondInteraction: async (
      sessionId: SessionId,
      key: string,
      response: OverviewInteractionResponse,
    ) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const pending = session.getSnapshot().pending.find(item => item.key === key)
      if (pending === undefined) throw new Error('This interaction is no longer pending')
      const result = response.kind === 'approval'
        ? pending.kind !== 'approval'
          ? undefined
          : {
            ok: true as const,
            value: {
              sessionId,
              approvalId: pending.payload.approvalId,
              outcome: response.outcome,
            },
          }
        : pending.kind !== 'question'
          ? undefined
          : response.kind === 'question-cancel'
            ? {
              ok: false as const,
              error: {
                code: 'cancelled' as const,
                message: 'the user closed this question request',
                details: {},
              },
            }
            : { ok: true as const, value: { sessionId, answer: response.answer } }
      if (result === undefined) throw new Error('The pending interaction type changed')
      const receipt = await pending.respond(result)
      if (!receipt.accepted) throw new Error(`interaction response rejected: ${receipt.reason}`)
    },
    steerSession: async (sessionId: SessionId, text: string) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.prompt([{ type: 'text', text }], 'steer')
      if (!result.ok) throw new Error(result.error.message)
    },
  })
  const refreshBrief = async (sessionId: SessionId): Promise<void> => {
    const result = await ctx.remote.commands.execute(sessionId, '/brief', [])
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
    if (result.value === undefined) throw new Error('Session brief refresh command is unavailable')
    if (result.value.result.kind === 'error') throw new Error(result.value.result.text)
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-overview', order: 10, store, inject: injected, locale: NS,
  }, OverviewWorkbench))
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'context', order: 5, label: () => t('view.context'), inject: () => ({ refreshBrief }), locale: NS,
  }, ContextView))
}
