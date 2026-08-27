import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, {
  createAssistantMessage,
  createUserMessage,
  CallId,
  isAgentLoopRequest,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService, { SessionBriefProviderId } from '@deepseek-ai/dsh-session-brief'
import type { SessionBriefProviderRequest } from '@deepseek-ai/dsh-session-brief'
import {
  generateSessionBriefWithLlm,
  resolveConfig,
  selectSessionBriefInput,
  SESSION_BRIEF_TIMEOUT_CODE,
} from '@deepseek-ai/dsh-session-brief-llm'
import * as SessionBriefLlmPlugin from '@deepseek-ai/dsh-session-brief-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(
    private readonly script: readonly StreamChunk[],
    private readonly onDispatch?: () => void,
  ) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.onDispatch?.()
    this.requests.push(options)
    yield * this.script
  }
}

class CooperativeAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (signal === undefined) throw new Error('expected brief request signal')
    await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise exact AbortSignal.reason propagation
        reject(signal.reason)
      }
      if (signal.aborted) rejectAbort()
      else signal.addEventListener('abort', rejectAbort, { once: true })
    })
  }
}

const CONFIG = {
  maxInputBytes: 4_000,
  maxOutputTokens: 256,
  timeoutMs: 1_000,
  provider: 'brief-route',
  model: 'brief-model',
} as const

const BRIEF_PROVIDER = SessionBriefProviderId('test-brief-provider')
let nextSession = 0

function output(sourceSeq: number, extra = ''): string {
  return JSON.stringify({
    schemaVersion: 1,
    task: 'Implement generated briefs',
    currentFocus: 'Validate LLM policy',
    completed: ['Service definition'],
    nextStep: 'Connect the UI',
    blockers: [],
    sourceEventSeqs: [sourceSeq],
    ...extra === '' ? {} : { extra },
  })
}

function script(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'usage', usage: { inputTokens: 120, outputTokens: 32, cacheReadTokens: 8 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function providerRequest(ctx: Context, signal = new AbortController().signal): SessionBriefProviderRequest {
  const session = ctx.sessions.create(SessionId(`brief-call-${++nextSession}`))
  session.append('request/header', {
    header: { config: { provider: 'logged-route', model: 'logged-model' } },
    reason: 'initial',
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Please implement generated Session briefs. SECRET_TOOL_ARG' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [
        { type: 'reasoning', text: 'PRIVATE_REASONING' },
        { type: 'text', text: 'The service definition is complete.' },
      ],
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId('sensitive-call'),
    name: 'write_file',
    arguments: '{"secret":"SECRET_TOOL_ARG"}',
  })
  return {
    session,
    header: session.header,
    events: session.events,
    sourceSeq: call.seq,
    limits: { maxBriefBytes: 2_000, maxItemsPerField: 8 },
    route: { provider: 'logged-route', model: 'logged-model' },
    signal,
  }
}

describe('generateSessionBriefWithLlm', () => {
  it('logs the exact bounded request before dispatch and records content-free token usage', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const request = providerRequest(ctx)
    let loggedAtDispatch = false
    const adapter = new RecordingAdapter(script(output(request.sourceSeq)), () => {
      loggedAtDispatch = request.session.events.some(event => event.type === 'session/brief-llm-request')
    })
    ctx.llm.registerAdapter(['brief-route'], adapter)

    const result = await generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER)

    expect(result).toMatchObject({
      task: 'Implement generated briefs',
      sourceEventSeqs: [request.sourceSeq],
      model: { provider: 'brief-route', model: 'brief-model' },
    })
    expect(loggedAtDispatch).toBe(true)
    expect(adapter.requests[0]).toMatchObject({
      provider: 'brief-route',
      model: 'brief-model',
      maxTokens: 256,
      purpose: 'session-brief',
    })
    expect(isAgentLoopRequest(adapter.requests[0]!)).toBe(false)
    expect(adapter.requests[0]?.tools).toBeUndefined()
    expect(adapter.requests[0]?.system).toContain('Never return null')
    expect(adapter.requests[0]?.system).toContain('minimum valid object')
    const framed = (adapter.requests[0]?.messages[0]?.content[0] as { text: string }).text
    expect(framed).not.toContain('PRIVATE_REASONING')
    expect(framed).not.toContain('{"secret"')
    expect(framed).toContain('write_file')
    expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data)
      .toMatchObject({
        sourceSeq: request.sourceSeq,
        outcome: 'generated',
        route: { provider: 'brief-route', model: 'brief-model' },
        usage: { inputTokens: 120, outputTokens: 32, cacheReadTokens: 8 },
      })
  })

  it('keeps newest facts under the exact byte limit and fails before dispatch when framing cannot fit', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const request = providerRequest(ctx)
    const full = selectSessionBriefInput(request, CONFIG.maxInputBytes)
    const minimum = selectSessionBriefInput(request, Buffer.byteLength(full.framedInput, 'utf8') - 1)
    expect(minimum.selectedEventSeqs.at(-1)).toBe(request.sourceSeq)
    expect(minimum.omittedFacts).toBeGreaterThan(0)
    expect(() => selectSessionBriefInput(request, 1)).toThrow(/fixed input framing/)
    expect(request.session.events.some(event => event.type === 'session/brief-llm-request')).toBe(false)
  })

  it('rejects Markdown, unknown fields, invalid citations, tool calls, and non-stop completion', async () => {
    const cases: Array<[readonly StreamChunk[], RegExp]> = [
      [script('```json\n{}\n```'), /raw JSON object/],
      [script(output(5, 'unknown')), /does not match brief schema/],
      [script(output(999)), /sourceEventSeqs/],
      [[
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: CallId('brief-tool'), name: 'read', argumentsDelta: '{}' },
        { type: 'finish', reason: { kind: 'stop' } },
      ], /text only/],
      [[{ type: 'finish', reason: { kind: 'max-tokens' } }], /maxOutputTokens/],
    ]
    for (const [chunks, expected] of cases) {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['brief-route'], new RecordingAdapter(chunks))
      const request = providerRequest(ctx)
      await expect(generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER))
        .rejects.toThrow(expected)
      expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data.outcome)
        .toBe('failed')
    }
  })

  it('validates route/config policy and enforces the end-to-end timeout', async () => {
    expect(() => resolveConfig(undefined as never)).toThrow(/configuration is required/)
    expect(() => resolveConfig(null as never)).toThrow(/configuration is required/)
    expect(() => resolveConfig('invalid' as never)).toThrow(/configuration is required/)
    expect(() => resolveConfig({ ...CONFIG, maxInputBytes: 0 })).toThrow(/positive integer/)
    expect(() => resolveConfig({ ...CONFIG, maxOutputTokens: 1.5 })).toThrow(/positive integer/)
    expect(() => resolveConfig({ ...CONFIG, timeoutMs: 0 })).toThrow(/positive integer/)
    expect(() => resolveConfig({ ...CONFIG, timeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/must not exceed/)
    expect(() => resolveConfig({ ...CONFIG, provider: undefined } as never)).toThrow(/supplied together/)
    expect(() => resolveConfig({ ...CONFIG, model: undefined } as never)).toThrow(/supplied together/)
    expect(() => resolveConfig({ ...CONFIG, provider: '', model: 'model' })).toThrow(/non-empty strings/)
    expect(() => resolveConfig({ ...CONFIG, provider: 'provider', model: '' })).toThrow(/non-empty strings/)
    expect(() => resolveConfig({ ...CONFIG, provider: 1, model: 'model' } as never)).toThrow(/non-empty strings/)
    expect(() => resolveConfig({ ...CONFIG, provider: 'provider', model: 1 } as never)).toThrow(/non-empty strings/)
    expect(() => resolveConfig({ ...CONFIG, extra: true } as never)).toThrow(/unknown config key/)

    vi.useFakeTimers()
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['brief-route'], new CooperativeAdapter())
      const request = providerRequest(ctx)
      const pending = generateSessionBriefWithLlm(
        ctx,
        resolveConfig({ ...CONFIG, timeoutMs: 10 }),
        request,
        BRIEF_PROVIDER,
      )
      const rejected = expect(pending).rejects.toMatchObject({ code: SESSION_BRIEF_TIMEOUT_CODE, timeoutMs: 10 })
      await vi.advanceTimersByTimeAsync(10)
      await rejected
      expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data)
        .toMatchObject({ outcome: 'failed', errorCode: SESSION_BRIEF_TIMEOUT_CODE })
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the logged route when no override is configured and rejects route absence before logging', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const adapter = new RecordingAdapter(script(output(4)))
    ctx.llm.registerAdapter(['logged-route'], adapter)
    const routed = providerRequest(ctx)
    await generateSessionBriefWithLlm(ctx, resolveConfig({
      maxInputBytes: 4_000,
      maxOutputTokens: 256,
      timeoutMs: 1_000,
    }), routed, BRIEF_PROVIDER)
    expect(adapter.requests[0]).toMatchObject({ provider: 'logged-route', model: 'logged-model' })

    const unroutedBase = providerRequest(ctx)
    const { route: _route, ...unrouted } = unroutedBase
    await expect(generateSessionBriefWithLlm(ctx, resolveConfig({
      maxInputBytes: 4_000,
      maxOutputTokens: 256,
      timeoutMs: 1_000,
    }), unrouted, BRIEF_PROVIDER)).rejects.toThrow(/no logged request route/)
    expect(unrouted.session.events.some(event => event.type === 'session/brief-llm-request')).toBe(false)
  })

  it.each([
    [{ kind: 'error', failure: { message: 'provider failed', code: 'SERVER' } }, 'provider failed', 'SERVER'],
    [{ kind: 'aborted', failure: { message: 'provider aborted', code: 'ABORTED' } }, 'provider aborted', 'ABORTED'],
    [{ kind: 'tool-calls' }, 'unexpectedly requested a tool', 'SESSION_BRIEF_OUTPUT_TOOL_REQUEST'],
    [{ kind: 'future' } as never, 'unsupported finish reason', 'SESSION_BRIEF_OUTPUT_FINISH'],
  ] as const)('rejects terminal finish %s and records its content-free code', async (reason, message, code) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['brief-route'], new RecordingAdapter([{ type: 'finish', reason }]))
    const request = providerRequest(ctx)
    await expect(generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER))
      .rejects.toThrow(message)
    expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data.errorCode)
      .toBe(code)
  })

  it('rejects empty text and duplicate citations while accepting all optional fields without usage', async () => {
    const empty = new Context()
    await empty.plugin(SessionStore)
    await empty.plugin(LlmRuntime)
    empty.llm.registerAdapter(['brief-route'], new RecordingAdapter([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'private' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    const emptyRequest = providerRequest(empty)
    await expect(generateSessionBriefWithLlm(empty, resolveConfig(CONFIG), emptyRequest, BRIEF_PROVIDER))
      .rejects.toThrow(/produced no text/)

    const duplicate = new Context()
    await duplicate.plugin(SessionStore)
    await duplicate.plugin(LlmRuntime)
    const duplicateRequest = providerRequest(duplicate)
    duplicate.llm.registerAdapter(['brief-route'], new RecordingAdapter(script(JSON.stringify({
      schemaVersion: 1,
      task: 'Task',
      completed: [],
      blockers: [],
      sourceEventSeqs: [duplicateRequest.sourceSeq, duplicateRequest.sourceSeq],
    }))))
    await expect(generateSessionBriefWithLlm(duplicate, resolveConfig(CONFIG), duplicateRequest, BRIEF_PROVIDER))
      .rejects.toThrow(/sourceEventSeqs/)

    const complete = new Context()
    await complete.plugin(SessionStore)
    await complete.plugin(LlmRuntime)
    const completeRequest = providerRequest(complete)
    complete.llm.registerAdapter(['brief-route'], new RecordingAdapter([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: JSON.stringify({
        schemaVersion: 1,
        task: 'Task',
        currentGoal: 'Goal',
        currentFocus: 'Focus',
        completed: [],
        nextStep: 'Next',
        blockers: [],
        waitingForUser: 'Answer',
        sourceEventSeqs: [completeRequest.sourceSeq],
      }) },
      { type: 'finish', reason: { kind: 'stop' } },
    ]))
    expect(await generateSessionBriefWithLlm(complete, resolveConfig(CONFIG), completeRequest, BRIEF_PROVIDER))
      .toMatchObject({ currentGoal: 'Goal', waitingForUser: 'Answer' })
    expect(completeRequest.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data.usage)
      .toBeUndefined()
  })

  it('records UnknownError for a raw non-Error stream rejection', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    vi.spyOn(ctx.llm, 'stream').mockImplementation(async function* () {
      throw 'raw failure'
    })
    const request = providerRequest(ctx)
    let caught: unknown
    try {
      await generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER)
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBe('raw failure')
    expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data.errorCode)
      .toBe('UnknownError')
  })

  it.each([
    [{ code: 1 }, 'UnknownError'],
    [Object.assign(new Error('empty code'), { code: '' }), 'Error'],
  ] as const)('ignores an invalid provider error code %#', async (failure, expectedCode) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    vi.spyOn(ctx.llm, 'stream').mockImplementation(async function* () {
      throw failure
    })
    const request = providerRequest(ctx)

    await expect(generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER)).rejects.toBe(failure)
    expect(request.session.events.findLast(event => event.type === 'session/brief-llm-result')?.data.errorCode)
      .toBe(expectedCode)
  })

  it('does not append failure accounting after the request Session is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['brief-route'], new CooperativeAdapter())
    let request!: SessionBriefProviderRequest
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      request = providerRequest(inner)
    }, { inject: ['sessions'] }))
    const controller = new AbortController()
    request = { ...request, signal: controller.signal }
    const generation = generateSessionBriefWithLlm(ctx, resolveConfig(CONFIG), request, BRIEF_PROVIDER)
    await Promise.resolve()
    await owner.dispose()
    controller.abort(new Error('disposed'))
    await expect(generation).rejects.toThrow(/disposed/)
    expect(request.session.events.filter(event => event.type === 'session/brief-llm-result')).toHaveLength(0)
  })

  it('registers the provider plugin and generates through SessionBriefService', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionBriefService, {
      automaticTriggers: [],
      minMeaningfulEvents: 1,
      maxBriefBytes: 2_000,
      maxItemsPerField: 8,
    })
    const session = ctx.sessions.create(SessionId('brief-plugin-registration'))
    const source = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Generate a brief' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    ctx.llm.registerAdapter(['brief-route'], new RecordingAdapter(script(output(source.seq))))
    await ctx.plugin(SessionBriefLlmPlugin, CONFIG)
    expect((await ctx.sessionBrief.refresh(session)).status).toBe('accepted')
  })
})
