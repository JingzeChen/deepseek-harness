import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createSessionActivityProjectionDefinition } from '@deepseek-ai/dsh-session-activity/src/projection.ts'

const definition = createSessionActivityProjectionDefinition({
  maxOpenTools: 2,
  maxErrorBytes: 5,
})

function at(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq * 10, data } as unknown as SessionEvent
}

function fold(events: readonly SessionEvent[]) {
  const state = events.reduce<ReturnType<typeof definition.init>>(
    (current, event) => definition.apply(current, event),
    definition.init(),
  )
  return definition.wire.view(state)
}

function result(callId: string): unknown {
  return { turn: 1, step: 1, message: { source: { kind: 'tool', callId } } }
}

describe('sessionActivity projection', () => {
  it('serves an empty bounded value and keeps the same reference for ignored events', () => {
    const state = definition.init()
    expect(definition.wire.view(state)).toEqual({
      lastMeaningfulSeq: null,
      lastMeaningfulAt: null,
      lastKind: null,
      openTools: [],
      openToolsOmitted: 0,
    })
    expect(definition.apply(state, at(1, 'assistant/chunk', {}))).toBe(state)
    expect(definition.apply(state, at(2, 'request/header', {}))).toBe(state)
    expect(definition.apply(state, at(3, 'compaction/end', { error: 'failed' }))).toBe(state)
  })

  it('pairs parallel tools by call id, preserves order, and reports the wire cap', () => {
    expect(fold([
      at(1, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'search', arguments: '{}' }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'build', arguments: '{}' }),
      at(4, 'tool/result', result('b')),
    ])).toEqual({
      lastMeaningfulSeq: 4,
      lastMeaningfulAt: 40,
      lastKind: 'tool',
      openTools: [
        { callId: 'a', name: 'read', startedAt: 10 },
        { callId: 'c', name: 'build', startedAt: 30 },
      ],
      openToolsOmitted: 0,
    })
    expect(fold([
      at(1, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'search', arguments: '{}' }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'build', arguments: '{}' }),
    ])).toMatchObject({ openToolsOmitted: 1 })
  })

  it('records Turn semantics separately and clears only that Turn pending calls', () => {
    expect(fold([
      at(1, 'tool/call', { turn: 1, step: 1, callId: 'old', name: 'read', arguments: '{}' }),
      at(2, 'tool/call', { turn: 2, step: 1, callId: 'next', name: 'search', arguments: '{}' }),
      at(3, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: '错误CODE', message: 'private detail' } },
      }),
    ])).toEqual({
      lastMeaningfulSeq: 3,
      lastMeaningfulAt: 30,
      lastKind: 'turn',
      lastTurn: { turn: 1, seq: 3, endedAt: 30, reason: 'error', errorCode: '错' },
      openTools: [{ callId: 'next', name: 'search', startedAt: 20 }],
      openToolsOmitted: 0,
    })
  })

  it.each(['user/message', 'assistant/message'])('counts finalized %s events as messages', (type) => {
    expect(fold([at(1, type, {})])).toMatchObject({
      lastKind: 'message',
      lastMeaningfulSeq: 1,
    })
  })

  it.each([
    { kind: 'completed' },
    { kind: 'aborted', reason: { kind: 'legacy' } },
    { kind: 'blocked' },
    { kind: 'max-tokens' },
    { kind: 'interrupted' },
  ])('preserves the known $kind Turn reason without asserting objective completion', (reason) => {
    expect(fold([at(1, 'turn/end', { turn: 2, reason })]).lastTurn).toMatchObject({
      turn: 2,
      reason: reason.kind,
    })
  })

  it('keeps an extension Turn end meaningful without misclassifying its outcome', () => {
    expect(fold([at(1, 'turn/end', { turn: 1, reason: { kind: 'extension' } })])).toEqual({
      lastMeaningfulSeq: 1,
      lastMeaningfulAt: 10,
      lastKind: 'turn',
      openTools: [],
      openToolsOmitted: 0,
    })
  })

  it('classifies domain changes without copying their payloads', () => {
    expect(fold([at(1, 'goal/change', {})])).toMatchObject({ lastKind: 'goal', lastMeaningfulSeq: 1 })
    expect(fold([at(2, 'todo/write', { todos: [] })])).toMatchObject({ lastKind: 'todo', lastMeaningfulSeq: 2 })
    expect(fold([at(4, 'compaction/end', {})])).toMatchObject({ lastKind: 'compaction', lastMeaningfulSeq: 4 })
  })

  it.each([
    'tool-workflow/run-start',
    'tool-workflow/agent-start',
    'tool-workflow/agent-end',
    'tool-workflow/run-end',
  ])('classifies %s as workflow activity', (type) => {
    expect(fold([at(3, type, {})])).toMatchObject({ lastKind: 'workflow', lastMeaningfulSeq: 3 })
  })

  it('validates restored state and wire values strictly', () => {
    expect(() => definition.stateSchema.parse({})).toThrow()
    expect(() => definition.wire.viewSchema.parse({
      ...fold([]),
      openToolsOmitted: -1,
    })).toThrow()
  })

  it('rejects checkpoints outside current bounds and reapplies the bound before serving', () => {
    const wide = createSessionActivityProjectionDefinition({ maxOpenTools: 2, maxErrorBytes: 5 })
    const narrow = createSessionActivityProjectionDefinition({ maxOpenTools: 1, maxErrorBytes: 2 })
    const wideState = wide.apply(wide.init(), at(1, 'turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'ABCDE', message: 'private detail' } },
    }))

    expect(wide.stateSchema.parse(wideState)).toEqual(wideState)
    expect(() => narrow.stateSchema.parse(wideState)).toThrow(/maxErrorBytes 2/)
    expect(narrow.wire.view(wideState).lastTurn?.errorCode).toBe('AB')
    expect(() => narrow.wire.viewSchema.parse({
      ...narrow.wire.view(wideState),
      openTools: [
        { callId: 'a', name: 'read', startedAt: 1 },
        { callId: 'b', name: 'search', startedAt: 2 },
      ],
    })).toThrow(/configured wire bounds/)
    expect(() => narrow.wire.viewSchema.parse({
      ...narrow.wire.view(wideState),
      lastTurn: { turn: 1, seq: 1, endedAt: 10, reason: 'error', errorCode: 'ABC' },
    })).toThrow(/configured wire bounds/)

    const wideUnicode = createSessionActivityProjectionDefinition({ maxOpenTools: 1, maxErrorBytes: 3 })
    const unicodeState = wideUnicode.apply(wideUnicode.init(), at(2, 'turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { code: '错', message: 'private detail' } },
    }))
    expect(narrow.wire.view(unicodeState).lastTurn).toEqual({
      turn: 2,
      seq: 2,
      endedAt: 20,
      reason: 'error',
    })

    const initiallyNarrow = narrow.apply(narrow.init(), at(3, 'turn/end', {
      turn: 3,
      reason: { kind: 'error', error: { code: '错', message: 'private detail' } },
    }))
    expect(narrow.wire.view(initiallyNarrow).lastTurn).toEqual({
      turn: 3,
      seq: 3,
      endedAt: 30,
      reason: 'error',
    })
  })
})
