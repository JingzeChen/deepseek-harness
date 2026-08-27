import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionBriefService from '@deepseek-ai/dsh-session-brief'
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

it('keeps brief content in the canonical log but removes it from telemetry', async () => {
  const ctx = new Context()
  const backend = new CollectingBackend()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionBriefService, {
    automaticTriggers: [],
    minMeaningfulEvents: 1,
    maxBriefBytes: 2_000,
    maxItemsPerField: 4,
  })
  await ctx.plugin({
    name: 'brief-telemetry-test',
    inject: ['sessions'],
    apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
  })
  const session = ctx.sessions.create(SessionId('brief-telemetry'))
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('session/brief', {
    version: 1,
    revision: 1,
    sourceSeq: 0,
    generatedAt: 10,
    task: 'PRIVATE GENERATED TASK',
    completed: ['PRIVATE RESULT'],
    blockers: [],
    provenance: { provider: 'route', model: 'model', sourceEventSeqs: [0] },
  }, { ignorable: true })

  const logged = session.events.at(-1)
  expect(logged?.type === 'session/brief' && logged.data.task).toBe('PRIVATE GENERATED TASK')
  const outbound = backend.records.find(record => record.attributes['event.type'] === 'session/brief')
  expect(JSON.stringify(outbound?.body)).not.toContain('PRIVATE')
  expect(outbound?.body).toMatchObject({
    revision: 1,
    sourceSeq: 0,
    completedCount: 1,
    provider: 'route',
    model: 'model',
  })
})
