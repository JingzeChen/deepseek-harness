import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionBriefInvariant from '@deepseek-ai/dsh-session-brief/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SessionBriefInvariant)
  return ctx
}

function brief(revision: number, sourceSeq = 0) {
  return {
    version: 1 as const,
    revision,
    sourceSeq,
    generatedAt: 1,
    task: 'Task',
    completed: [],
    blockers: [],
    provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [sourceSeq] },
  }
}

describe('Session brief invariant', () => {
  it('accepts an ignorable advancing brief with existing ordered sources', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('brief-invariant-valid'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(() => session.append('session/brief', brief(1), { ignorable: true })).not.toThrow()
  })

  it.each([
    ['required event', brief(1), undefined],
    ['future source', brief(1, 2), { ignorable: true }],
    ['missing citation', { ...brief(1), provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [9] } }, { ignorable: true }],
    ['duplicate revision', brief(1), { ignorable: true }],
  ])('rejects %s', async (_name, data, intent) => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId(`brief-invariant-${_name}`))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    if (_name === 'duplicate revision') session.append('session/brief', brief(1), { ignorable: true })
    const append = () => intent === undefined
      ? session.append('session/brief', data)
      : session.append('session/brief', data, intent as never)
    expect(append).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-brief',
    }))
  })
})
