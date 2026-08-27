import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { OverviewWorkbench, type OverviewWorkbenchInjected } from '../src/client/OverviewWorkbench.tsx'
import { ContextView } from '../src/client/ContextView.tsx'
import { apply, inject } from '../src/client/index.ts'

async function bench(cancelResult: { ok: true; value: { accepted: true } } | { ok: false; error: { message: string } } = {
  ok: true, value: { accepted: true },
}, commandResult: {
  ok: true
  value: { commandId: string; result: { kind: 'success'; text?: string } | { kind: 'error'; text: string } } | undefined
} | { ok: false; error: { code: string; message: string } } = {
  ok: true, value: { commandId: 'command', result: { kind: 'success' } },
}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const open = vi.fn()
  const cancel = vi.fn(async () => cancelResult)
  const respond = vi.fn(async () => ({ accepted: true as const }))
  const pending: Array<{
    key: string
    kind: 'approval' | 'question'
    payload: Record<string, unknown>
    respond: typeof respond
  }> = []
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const execute = vi.fn(async () => commandResult)
  const commandsRemote = { execute }
  const binding = vi.fn<() => { session: {
    cancel: typeof cancel
    getSnapshot: () => { pending: typeof pending }
    prompt: typeof prompt
  } } | undefined>(
    () => ({ session: { cancel, getSnapshot: () => ({ pending }), prompt } }),
  )
  const archiveSession = vi.fn(async () => {})
  ctx.provide('sessions', { open, binding } as never)
  ctx.provide('workspaces', { archiveSession } as never)
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, open, cancel, execute, binding,
    archiveSession, pending, prompt, respond,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

describe('ui-session-overview apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'remote', 'remote.commands', 'locale'])
  })

  it('registers the shared-store entries and Context tab before or after declarations and disposes them', async () => {
    const before = await bench()
    declare(before.slots)
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(before.slots.entries('shell.overlay')[0]?.component).toBe(OverviewWorkbench)
    expect(before.slots.entries('conversation.view')[0]?.component).toBe(ContextView)
    expect(before.slots.entries('conversation.view')[0]?.options.label).toBeTypeOf('function')
    expect((before.slots.entries('conversation.view')[0]?.options.label as () => string)()).toBe('上下文')
    expect(before.locale.bind('sessionOverview')('title')).toBe('DSH 信标')
    await fiber.dispose()
    expect(before.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(before.slots.entries('shell.overlay')).toHaveLength(0)
    expect(before.slots.entries('conversation.view')).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(after.slots.entries('shell.overlay')).toHaveLength(1)
    expect(after.slots.entries('conversation.view')).toHaveLength(1)
  })

  it('routes open, cancel, and archive through existing service faces', async () => {
    const fixture = await bench()
    declare(fixture.slots)
    await fixture.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (fixture.slots.entries('shell.overlay')[0]?.inject as unknown as () => OverviewWorkbenchInjected)()
    injected.openSession('session' as never)
    expect(fixture.open).toHaveBeenCalledWith('session')
    await injected.cancelSession('session' as never)
    expect(fixture.binding).toHaveBeenCalledWith('session')
    expect(fixture.cancel).toHaveBeenCalled()
    await injected.archiveSession('session' as never)
    expect(fixture.archiveSession).toHaveBeenCalledWith('session')
  })

  it('routes approval, question, cancellation, and steer through the current Session carrier', async () => {
    const fixture = await bench()
    declare(fixture.slots)
    await fixture.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (fixture.slots.entries('shell.overlay')[0]?.inject as unknown as () => OverviewWorkbenchInjected)()
    fixture.pending.push({
      key: 'a:1', kind: 'approval',
      payload: { approvalId: 'approval-1', toolName: 'terminal' },
      respond: fixture.respond,
    })
    await injected.respondInteraction('session' as never, 'a:1', {
      kind: 'approval', outcome: 'allowed-once',
    })
    expect(fixture.respond).toHaveBeenLastCalledWith({
      ok: true,
      value: { sessionId: 'session', approvalId: 'approval-1', outcome: 'allowed-once' },
    })

    fixture.pending.splice(0, 1, {
      key: 'q:1', kind: 'question', payload: { questions: [] }, respond: fixture.respond,
    })
    const answer = { answers: [{ id: 'name', selected: [], custom: 'Ada' }] }
    await injected.respondInteraction('session' as never, 'q:1', { kind: 'question', answer })
    expect(fixture.respond).toHaveBeenLastCalledWith({
      ok: true, value: { sessionId: 'session', answer },
    })
    await injected.respondInteraction('session' as never, 'q:1', { kind: 'question-cancel' })
    expect(fixture.respond).toHaveBeenLastCalledWith({
      ok: false,
      error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
    })

    await injected.steerSession('session' as never, 'Inspect the failing test')
    expect(fixture.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'Inspect the failing test' }],
      'steer',
    )
  })

  it('rejects stale or changed interactions, rejected receipts, and steer failures', async () => {
    const fixture = await bench()
    declare(fixture.slots)
    await fixture.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (fixture.slots.entries('shell.overlay')[0]?.inject as unknown as () => OverviewWorkbenchInjected)()
    await expect(injected.respondInteraction('session' as never, 'missing', {
      kind: 'approval', outcome: 'rejected',
    })).rejects.toThrow('no longer pending')
    fixture.binding.mockReturnValueOnce(undefined)
    await expect(injected.respondInteraction('missing' as never, 'missing', {
      kind: 'approval', outcome: 'rejected',
    })).rejects.toThrow('unknown session')

    fixture.pending.push({
      key: 'q:1', kind: 'question', payload: { questions: [] }, respond: fixture.respond,
    })
    await expect(injected.respondInteraction('session' as never, 'q:1', {
      kind: 'approval', outcome: 'rejected',
    })).rejects.toThrow('type changed')

    fixture.pending.splice(0, 1, {
      key: 'a:1', kind: 'approval',
      payload: { approvalId: 'approval', toolName: 'terminal' }, respond: fixture.respond,
    })
    await expect(injected.respondInteraction('session' as never, 'a:1', {
      kind: 'question', answer: { answers: [] },
    })).rejects.toThrow('type changed')

    fixture.pending.splice(0, 1, {
      key: 'q:1', kind: 'question', payload: { questions: [] }, respond: fixture.respond,
    })
    fixture.respond.mockResolvedValueOnce({ accepted: false, reason: 'already answered' } as never)
    await expect(injected.respondInteraction('session' as never, 'q:1', {
      kind: 'question', answer: { answers: [] },
    })).rejects.toThrow('already answered')

    fixture.prompt.mockResolvedValueOnce({ ok: false, error: { message: 'steer unavailable' } } as never)
    await expect(injected.steerSession('session' as never, 'Continue')).rejects.toThrow('steer unavailable')
    fixture.binding.mockReturnValueOnce(undefined)
    await expect(injected.steerSession('missing' as never, 'Continue')).rejects.toThrow('unknown session')
  })

  it('rejects unknown Sessions and cancel business failures', async () => {
    const unknown = await bench()
    unknown.binding.mockReturnValueOnce(undefined)
    declare(unknown.slots)
    await unknown.ctx.plugin({ inject: [...inject], apply }).await()
    const unknownFace = (unknown.slots.entries('shell.overlay')[0]?.inject as unknown as () => OverviewWorkbenchInjected)()
    await expect(unknownFace.cancelSession('missing' as never)).rejects.toThrow('unknown session')

    const rejected = await bench({ ok: false, error: { message: 'not running' } })
    declare(rejected.slots)
    await rejected.ctx.plugin({ inject: [...inject], apply }).await()
    const rejectedFace = (rejected.slots.entries('shell.overlay')[0]?.inject as unknown as () => OverviewWorkbenchInjected)()
    await expect(rejectedFace.cancelSession('session' as never)).rejects.toThrow('not running')
  })

  it('routes generated brief refresh through /brief and rejects unavailable admission', async () => {
    const fixture = await bench()
    declare(fixture.slots)
    await fixture.ctx.plugin({ inject: [...inject], apply }).await()
    const contextEntry = fixture.slots.entries('conversation.view')[0]
    const injected = (contextEntry?.inject as unknown as () => {
      refreshBrief(sessionId: never): Promise<void>
    })()
    await injected.refreshBrief('session' as never)
    expect(fixture.execute).toHaveBeenCalledWith('session', '/brief', [])

    const unknown = await bench(undefined, {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'unknown session' },
    })
    declare(unknown.slots)
    await unknown.ctx.plugin({ inject: [...inject], apply }).await()
    const unknownRefresh = (unknown.slots.entries('conversation.view')[0]?.inject as unknown as () => {
      refreshBrief(sessionId: never): Promise<void>
    })()
    await expect(unknownRefresh.refreshBrief('missing' as never)).rejects.toThrow('unknown session')

    const unmatched = await bench(undefined, { ok: true, value: undefined })
    declare(unmatched.slots)
    await unmatched.ctx.plugin({ inject: [...inject], apply }).await()
    const unmatchedRefresh = (unmatched.slots.entries('conversation.view')[0]?.inject as unknown as () => {
      refreshBrief(sessionId: never): Promise<void>
    })()
    await expect(unmatchedRefresh.refreshBrief('session' as never)).rejects.toThrow('unavailable')

    const failed = await bench(undefined, {
      ok: true,
      value: {
        commandId: 'failed',
        result: { kind: 'error', text: 'The brief provider failed (SESSION_BRIEF_OUTPUT_SCHEMA).' },
      },
    })
    declare(failed.slots)
    await failed.ctx.plugin({ inject: [...inject], apply }).await()
    const failedRefresh = (failed.slots.entries('conversation.view')[0]?.inject as unknown as () => {
      refreshBrief(sessionId: never): Promise<void>
    })()
    await expect(failedRefresh.refreshBrief('session' as never)).rejects.toThrow('SESSION_BRIEF_OUTPUT_SCHEMA')
  })
})
