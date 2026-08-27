import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionBriefProviderRequest } from '@deepseek-ai/dsh-session-brief'
import { selectSessionBriefInput } from '@deepseek-ai/dsh-session-brief-llm'

function request(
  session: Session,
  limits = { maxBriefBytes: 4_000, maxItemsPerField: 20 },
  previous?: SessionBriefProviderRequest['previous'],
): SessionBriefProviderRequest {
  return {
    session,
    header: session.header,
    events: session.events,
    sourceSeq: session.seq - 1,
    limits,
    ...(previous === undefined ? {} : { previous }),
    signal: new AbortController().signal,
  }
}

function documentOf(selected: ReturnType<typeof selectSessionBriefInput>) {
  return JSON.parse(selected.framedInput.slice(selected.framedInput.indexOf('\n') + 1)) as {
    session: { cwd?: string; parentSession?: string }
    previous: unknown
    previousOmitted: boolean
    facts: Array<{ seq: number; kind: string; value: unknown }>
    omittedFacts: number
  }
}

describe('Session brief input selection', () => {
  it('selects latest structured facts, visible text, error code, and open tool name only', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('brief-selection-all'), {
      meta: { cwd: process.cwd(), parentSession: SessionId('parent') },
    })
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Visible user task' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }],
      source: { kind: 'plugin', plugin: 'empty' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'reasoning', text: 'PRIVATE' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'Visible result' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('session/title', {
      title: 'Durable title',
      messageSeqs: [user.seq],
      source: { kind: 'fallback' },
    })
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'block',
      goal: {
        id: 'goal' as never,
        revision: 1,
        objective: 'Ship briefs',
        phase: 'blocked',
        blockedReason: { code: 'input', message: 'Need user input' },
        maxGoalRounds: 3,
      },
      roundsStarted: 1,
      createdAt: 1,
      updatedAt: 2,
    })
    session.append('todo/write', {
      todos: [{ content: 'Implement provider', status: 'in_progress' }],
    })
    session.append('tool/call', {
      turn: 1,
      step: 2,
      callId: CallId('closed'),
      name: 'closed_tool',
      arguments: '{"private":true}',
    })
    const open = session.append('tool/call', {
      turn: 2,
      step: 1,
      callId: CallId('open'),
      name: 'open_tool',
      arguments: '{"secret":"PRIVATE ARG"}',
    })
    session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'FAILED', message: 'PRIVATE ERROR' } },
    })

    const selected = selectSessionBriefInput(request(session), 10_000)
    const document = documentOf(selected)
    expect(document.session).toEqual({ cwd: process.cwd(), parentSession: 'parent' })
    expect(document.facts.map(fact => fact.kind)).toEqual([
      'user', 'assistant', 'title', 'goal', 'todos', 'open-tool', 'turn',
    ])
    expect(document.facts.find(fact => fact.kind === 'open-tool'))
      .toEqual({ seq: open.seq, kind: 'open-tool', value: { name: 'open_tool' } })
    expect(selected.framedInput).not.toContain('PRIVATE')
    expect(selected.framedInput).not.toContain('closed_tool')
    expect(selected.framedInput).toContain('FAILED')
  })

  it('selects active and cleared Goal variants without inventing blockedReason', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('brief-selection-goal'))
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: 'goal' as never,
        revision: 1,
        objective: 'Active objective',
        phase: 'active',
        maxGoalRounds: 3,
      },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(documentOf(selectSessionBriefInput(request(session), 2_000)).facts[0]?.value)
      .toEqual({ operation: 'create', objective: 'Active objective', phase: 'active' })
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'clear',
      cleared: { id: 'goal' as never, revision: 1 },
      clearedAt: 2,
    })
    expect(documentOf(selectSessionBriefInput(request(session), 2_000)).facts)
      .toEqual([{ seq: 1, kind: 'goal', value: { operation: 'clear' } }])
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(documentOf(selectSessionBriefInput(request(session), 2_000)).facts.at(-1))
      .toEqual({ seq: 2, kind: 'turn', value: { kind: 'completed' } })
  })

  it('removes paired tools and retains no arbitrary tool result content', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('brief-selection-tool-result'))
    const callId = CallId('paired')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read_secret', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'PRIVATE TOOL RESULT' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    expect(() => selectSessionBriefInput(request(session), 2_000)).toThrow(/no source facts fit/)
  })

  it('retains or omits the previous brief, caps citations, and refuses oversized source facts', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('brief-selection-budget'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'second' }],
      }),
    }, { surfaceOp: 'append' })
    const previous = {
      version: 1 as const,
      revision: 1,
      sourceSeq: 0,
      generatedAt: 1,
      task: 'Previous task',
      completed: [],
      blockers: [],
      provenance: { provider: 'route', model: 'model', sourceEventSeqs: [0] },
    }
    const retained = documentOf(selectSessionBriefInput(request(session, {
      maxBriefBytes: 4_000,
      maxItemsPerField: 1,
    }, previous), 4_000))
    expect(retained.previous).toMatchObject({ task: 'Previous task' })
    expect(retained.facts).toHaveLength(1)
    expect(retained.omittedFacts).toBe(1)

    const hugePrevious = { ...previous, task: 'p'.repeat(4_000) }
    const omitted = documentOf(selectSessionBriefInput(request(session, undefined, hugePrevious), 1_000))
    expect(omitted.previous).toBeNull()
    expect(omitted.previousOmitted).toBe(true)

    const huge = ctx.sessions.create(SessionId('brief-selection-huge'))
    huge.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'x'.repeat(4_000) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => selectSessionBriefInput(request(huge), 300)).toThrow(/no source facts fit/)
  })
})
