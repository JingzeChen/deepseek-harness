import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService, { SessionBriefProviderId } from '@deepseek-ai/dsh-session-brief'
import * as SessionBriefLlm from '@deepseek-ai/dsh-session-brief-llm'
import {
  SessionTelemetryCoordinator,
  type SessionTelemetryRecord,
  type SessionTelemetrySink,
} from '@deepseek-ai/dsh-session-telemetry'

class CollectingBackend implements SessionTelemetrySink {
  readonly records: SessionTelemetryRecord[] = []
  emit(record: SessionTelemetryRecord): void {
    this.records.push(record)
  }
  async shutdown(): Promise<void> {}
}

describe('Session brief LLM telemetry', () => {
  it('keeps exact requests locally but removes prompt content from telemetry', async () => {
    const ctx = new Context()
    const backend = new CollectingBackend()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionBriefService, {
      automaticTriggers: [],
      minMeaningfulEvents: 1,
      maxBriefBytes: 2_000,
      maxItemsPerField: 4,
    })
    await ctx.plugin(SessionBriefLlm, {
      maxInputBytes: 2_000,
      maxOutputTokens: 128,
      timeoutMs: 1_000,
      provider: 'route',
      model: 'model',
    })
    await ctx.plugin({
      name: 'brief-llm-telemetry-test',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    const session = ctx.sessions.create(SessionId('brief-request-telemetry'))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const messages = [createUserMessage({
      content: [{ type: 'text', text: 'PRIVATE FRAMED INPUT' }],
      source: { kind: 'plugin', plugin: 'test' },
    })]
    session.append('session/brief-llm-request', {
      briefProvider: SessionBriefProviderId('test'),
      sourceSeq: 0,
      selectedEventSeqs: [0],
      route: { provider: 'route', model: 'model' },
      schemaVersion: 1,
      system: 'PRIVATE SYSTEM',
      messages,
      maxTokens: 128,
    }, { ignorable: true })

    const logged = session.events.at(-1)
    expect(logged?.type === 'session/brief-llm-request' && logged.data.system).toBe('PRIVATE SYSTEM')
    const outbound = backend.records.find(record => record.attributes['event.type'] === 'session/brief-llm-request')
    expect(JSON.stringify(outbound?.body)).not.toContain('PRIVATE')
    expect(outbound?.body).toMatchObject({
      sourceSeq: 0,
      selectedEventSeqs: [0],
      route: { provider: 'route', model: 'model' },
      maxTokens: 128,
    })
  })
})
