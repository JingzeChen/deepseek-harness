import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService, { SessionBriefProviderId } from '@deepseek-ai/dsh-session-brief'
import type { Config, SessionBriefProviderRequest, SessionBriefRefreshResult } from '@deepseek-ai/dsh-session-brief'
import * as CommandSessionBrief from '@deepseek-ai/dsh-command-session-brief'

const CONFIG: Config = {
  automaticTriggers: [],
  minMeaningfulEvents: 1,
  maxBriefBytes: 2_000,
  maxItemsPerField: 4,
}

describe('/brief command', () => {
  it('refreshes through the service without opening a Turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Commands)
    await ctx.plugin(SessionBriefService, CONFIG)
    const commandFiber = await ctx.plugin(CommandSessionBrief)
    const generate = vi.fn(async (request: SessionBriefProviderRequest) => ({
      task: 'Manual refresh',
      completed: [],
      blockers: [],
      sourceEventSeqs: [request.sourceSeq],
      model: { provider: 'test', model: 'brief' },
    }))
    ctx.sessionBrief.register({ id: SessionBriefProviderId('test'), generate })
    const session = ctx.sessions.create(SessionId('brief-command'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      ctx,
      runMaintenance: (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    } as never

    const definition = ctx.commands.find(agent, 'brief')
    if (definition === undefined) throw new Error('brief command was not registered')
    const result = await definition.handler({
      commandId: 'command' as never,
      agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ kind: 'success', text: 'Session brief refreshed.' })
    expect(generate).toHaveBeenCalledOnce()
    expect(session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(session.events.at(-1)).toMatchObject({ type: 'session/brief', ignorable: true })
    await commandFiber.dispose()
  })

  it('maps arguments and every typed non-accepted outcome to human-only results', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Commands)
    await ctx.plugin(SessionBriefService, CONFIG)
    const commandFiber = await ctx.plugin(CommandSessionBrief)
    const session = ctx.sessions.create(SessionId('brief-command-outcomes'))
    const agent = { id: session.id, session, status: 'idle', ctx } as never
    const definition = ctx.commands.find(agent, 'brief')
    if (definition === undefined) throw new Error('brief command was not registered')
    const invoke = (rawInput: string) => definition.handler({
      commandId: 'command' as never,
      agent,
      rawInput,
      attachments: [],
      signal: new AbortController().signal,
    })

    await expect(invoke(' unexpected')).resolves.toEqual({ kind: 'error', text: 'Usage: /brief (no arguments)' })
    const refresh = vi.spyOn(ctx.sessionBrief, 'refresh')
    const cases: Array<[SessionBriefRefreshResult, { kind: 'success' | 'error'; text: string }]> = [
      [{ status: 'unavailable', reason: 'no-provider' }, { kind: 'error', text: 'Session brief generation is not configured.' }],
      [{ status: 'unavailable', reason: 'no-meaningful-events' }, { kind: 'success', text: 'No meaningful Session activity is available to summarize.' }],
      [{ status: 'busy' }, { kind: 'error', text: 'Session brief refresh is unavailable while the Agent or another refresh is active.' }],
      [{ status: 'failed', reason: 'cancelled' }, { kind: 'error', text: 'Session brief refresh cancelled.' }],
      [{ status: 'failed', reason: 'stale' }, { kind: 'error', text: 'Session activity changed before the brief could be accepted.' }],
      [{ status: 'failed', reason: 'invalid-result' }, { kind: 'error', text: 'The brief provider returned an invalid result.' }],
      [{ status: 'failed', reason: 'provider-failed' }, { kind: 'error', text: 'The brief provider failed.' }],
      [{ status: 'failed', reason: 'provider-failed', code: 'SESSION_BRIEF_OUTPUT_SCHEMA' }, { kind: 'error', text: 'The brief provider failed (SESSION_BRIEF_OUTPUT_SCHEMA).' }],
    ]
    for (const [outcome, expected] of cases) {
      refresh.mockResolvedValueOnce(outcome)
      await expect(invoke('')).resolves.toEqual(expected)
    }
    await commandFiber.dispose()
  })
})
