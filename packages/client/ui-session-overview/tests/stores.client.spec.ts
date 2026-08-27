import { describe, expect, it } from 'vitest'
import { createSessionOverviewViewStore } from '../src/client/stores.ts'

describe('session overview view store', () => {
  it('updates workbench controls through declared actions', () => {
    const instance = createSessionOverviewViewStore().create('controls')
    instance.actions.setOpen(true)
    instance.actions.setBeaconPosition({ x: 0.25, y: 0.75 })
    instance.actions.setQuery('blocked')
    instance.actions.setAttention('needs-action')
    instance.actions.setWorkspaceId('workspace')
    instance.actions.setPinnedOnly(true)
    instance.actions.selectSession('session')
    expect(instance.getSnapshot()).toMatchObject({
      open: true,
      beaconPosition: { x: 0.25, y: 0.75 },
      query: 'blocked',
      attention: 'needs-action',
      workspaceId: 'workspace',
      pinnedOnly: true,
      selectedSessionId: 'session',
    })
  })

  it('owns pin, snooze, bookmark, and last-viewed state per Session', () => {
    const instance = createSessionOverviewViewStore().create('reviews')
    instance.actions.togglePinned('session')
    instance.actions.setSnoozedUntil('session', 2_000)
    instance.actions.setBookmark('session', '  Review the diff  ')
    instance.actions.markViewed('session', 42)
    expect(instance.getSnapshot().reviews.session).toEqual({
      pinned: true,
      snoozedUntil: 2_000,
      bookmark: 'Review the diff',
      lastViewedSeq: 42,
    })

    instance.actions.togglePinned('session')
    instance.actions.setSnoozedUntil('session', undefined)
    instance.actions.setBookmark('session', ' ')
    expect(instance.getSnapshot().reviews.session).toEqual({ lastViewedSeq: 42 })
  })

  it('prunes removed Sessions, expired snoozes, empty reviews, and stale selection', () => {
    const instance = createSessionOverviewViewStore().create('pruning')
    instance.actions.selectSession('removed')
    instance.actions.setSnoozedUntil('kept', 100)
    instance.actions.setSnoozedUntil('future', 2_000)
    instance.actions.togglePinned('removed')
    instance.actions.retainSessions(['kept', 'future'], 1_000)
    expect(instance.getSnapshot()).toMatchObject({
      selectedSessionId: null,
      reviews: { future: { snoozedUntil: 2_000 } },
    })
  })

  it('removes a review after its last optional field is cleared', () => {
    const instance = createSessionOverviewViewStore().create('empty-review')
    instance.actions.togglePinned('session')
    instance.actions.togglePinned('session')
    expect(instance.getSnapshot().reviews).toEqual({})

    instance.actions.setSnoozedUntil('session', 2_000)
    instance.actions.setSnoozedUntil('session', undefined)
    expect(instance.getSnapshot().reviews).toEqual({})

    instance.actions.setBookmark('session', 'note')
    instance.actions.setBookmark('session', undefined)
    expect(instance.getSnapshot().reviews).toEqual({})
  })
})
