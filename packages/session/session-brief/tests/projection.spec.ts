import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionBriefService from '@deepseek-ai/dsh-session-brief'
import { createSessionBriefProjectionDefinition } from '@deepseek-ai/dsh-session-brief'
import type { Config } from '@deepseek-ai/dsh-session-brief'

const CONFIG: Config = {
  automaticTriggers: [],
  minMeaningfulEvents: 1,
  maxBriefBytes: 1024,
  maxItemsPerField: 4,
}

describe('sessionBrief projection', () => {
  it('serves null before acceptance and applies complete events last-wins', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionBriefService, CONFIG)
    const session = ctx.sessions.create(SessionId('brief-projection'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionBrief).toBeNull()

    const first = {
      version: 1 as const,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 10,
      task: 'First task',
      completed: [],
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0] },
    }
    session.append('session/brief', first, { ignorable: true })
    session.append('session/brief', { ...first, revision: 2, task: 'Second task' }, { ignorable: true })

    expect(ctx.sessionProjections.snapshot(session).values.sessionBrief).toMatchObject({
      revision: 2,
      task: 'Second task',
      sourceSeq: 0,
    })
  })

  it('keeps unrelated state by identity and rejects invalid citations, arrays, and byte size', () => {
    const definition = createSessionBriefProjectionDefinition({ maxBriefBytes: 300, maxItemsPerField: 2 })
    const initial = definition.init()
    const unrelated = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as const
    expect(definition.apply(initial, unrelated)).toBe(initial)
    const base = {
      version: 1 as const,
      revision: 1,
      sourceSeq: 1,
      generatedAt: 10,
      task: 'Task',
      completed: [],
      blockers: [],
      provenance: { provider: 'test', model: 'brief', sourceEventSeqs: [0, 1] },
    }
    expect(definition.stateSchema.safeParse(base).success).toBe(true)
    expect(definition.stateSchema.safeParse({
      ...base,
      provenance: { ...base.provenance, sourceEventSeqs: [1, 0] },
    }).success).toBe(false)
    expect(definition.stateSchema.safeParse({
      ...base,
      sourceSeq: 0,
    }).success).toBe(false)
    expect(definition.stateSchema.safeParse({
      ...base,
      completed: ['one', 'two', 'three'],
    }).success).toBe(false)
    expect(definition.stateSchema.safeParse({
      ...base,
      task: 'x'.repeat(400),
    }).success).toBe(false)
  })
})
