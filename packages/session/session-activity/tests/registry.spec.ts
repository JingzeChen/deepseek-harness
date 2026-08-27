import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionActivityPlugin from '@deepseek-ai/dsh-session-activity'

describe('sessionActivity registry integration', () => {
  it('serves configured activity and removes the key on plugin disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('activity'))

    expect('sessionActivity' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionActivityPlugin, { maxOpenTools: 1, maxErrorBytes: 64 })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('first'),
      name: 'read',
      arguments: '{}',
    })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('second'),
      name: 'search',
      arguments: '{}',
    })

    expect(ctx.sessionProjections.snapshot(session).values.sessionActivity).toMatchObject({
      lastKind: 'tool',
      openTools: [{ callId: 'first', name: 'read' }],
      openToolsOmitted: 1,
    })
    await fiber.dispose()
    expect('sessionActivity' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
