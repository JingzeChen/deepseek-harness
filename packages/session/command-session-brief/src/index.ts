/**
 * Human-facing `/brief` command for explicit generated Session catch-up.
 * @module @deepseek-ai/dsh-command-session-brief
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionBriefRefreshResult } from '@deepseek-ai/dsh-session-brief'

/** Cordis plugin name. */
export const name = 'command-session-brief'
/** Services required by the command consumer. */
export const inject = ['commands', 'sessionBrief']

function resultText(result: SessionBriefRefreshResult): CommandResult {
  switch (result.status) {
    case 'accepted':
      return { kind: 'success', text: 'Session brief refreshed.' }
    case 'unavailable':
      return result.reason === 'no-provider'
        ? { kind: 'error', text: 'Session brief generation is not configured.' }
        : { kind: 'success', text: 'No meaningful Session activity is available to summarize.' }
    case 'busy':
      return { kind: 'error', text: 'Session brief refresh is unavailable while the Agent or another refresh is active.' }
    case 'failed': {
      const reason = result.reason
      switch (reason) {
        case 'cancelled': return { kind: 'error', text: 'Session brief refresh cancelled.' }
        case 'stale': return { kind: 'error', text: 'Session activity changed before the brief could be accepted.' }
        case 'invalid-result': return { kind: 'error', text: 'The brief provider returned an invalid result.' }
        case 'provider-failed': return {
          kind: 'error',
          text: result.code === undefined
            ? 'The brief provider failed.'
            : `The brief provider failed (${result.code}).`,
        }
        /* v8 ignore next -- closed SessionBriefRefreshResult reason union */
        default: return assertNever(reason)
      }
    }
    /* v8 ignore next -- closed SessionBriefRefreshResult status union */
    default:
      return assertNever(result)
  }
}

/* v8 ignore start -- closed-union backstop */
function assertNever(value: never): never {
  throw new TypeError(`unknown Session brief refresh outcome: ${String(value)}`)
}
/* v8 ignore stop */

async function execute(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: 'Usage: /brief (no arguments)' }
  }
  return resultText(await ctx.sessionBrief.refresh(invocation.agent.session, invocation.signal))
}

/**
 * Register `/brief` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and Session brief service.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = execute(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }
  ctx.effect(function* () {
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'brief',
      description: 'Refresh the generated Session brief',
      handler,
    })
  }, 'command-session-brief lifecycle')
}
