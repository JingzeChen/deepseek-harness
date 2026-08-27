/** Shared browser-local state for the overview trigger and workbench. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { OverviewAttentionState, SessionOverviewReview } from './derive.ts'

/** Attention filter selected in the workbench toolbar. */
export type OverviewAttentionFilter = 'all' | OverviewAttentionState

/** Viewport-relative center used to restore the floating beacon after resize or reload. */
export interface OverviewBeaconPosition {
  x: number
  y: number
}

/** Persisted presentation and review state. */
export interface SessionOverviewViewState {
  open: boolean
  beaconPosition?: OverviewBeaconPosition
  query: string
  attention: OverviewAttentionFilter
  workspaceId: string | null
  pinnedOnly: boolean
  selectedSessionId: string | null
  reviews: Record<string, SessionOverviewReview>
}

type SessionOverviewViewActions = {
  setOpen: (draft: SessionOverviewViewState, open: boolean) => void
  setBeaconPosition: (draft: SessionOverviewViewState, position: OverviewBeaconPosition) => void
  setQuery: (draft: SessionOverviewViewState, query: string) => void
  setAttention: (draft: SessionOverviewViewState, attention: OverviewAttentionFilter) => void
  setWorkspaceId: (draft: SessionOverviewViewState, workspaceId: string | null) => void
  setPinnedOnly: (draft: SessionOverviewViewState, pinnedOnly: boolean) => void
  selectSession: (draft: SessionOverviewViewState, sessionId: string | null) => void
  togglePinned: (draft: SessionOverviewViewState, sessionId: string) => void
  setSnoozedUntil: (draft: SessionOverviewViewState, sessionId: string, until: number | undefined) => void
  setBookmark: (draft: SessionOverviewViewState, sessionId: string, bookmark: string | undefined) => void
  markViewed: (draft: SessionOverviewViewState, sessionId: string, seq: number) => void
  retainSessions: (draft: SessionOverviewViewState, sessionIds: readonly string[], now: number) => void
}

function reviewOf(draft: SessionOverviewViewState, sessionId: string): SessionOverviewReview {
  return draft.reviews[sessionId] ??= {}
}

function removeEmptyReview(draft: SessionOverviewViewState, sessionId: string): void {
  const review = draft.reviews[sessionId]
  if (review !== undefined && Object.keys(review).length === 0) {
    draft.reviews = Object.fromEntries(
      Object.entries(draft.reviews).filter(([key]) => key !== sessionId),
    )
  }
}

/**
 * Create the root-scoped overview store shared by the trigger and overlay.
 * @returns one persisted store handle for a plugin application.
 */
export function createSessionOverviewViewStore(): EngineStoreHandle<
  SessionOverviewViewState,
  SessionOverviewViewActions
> {
  return defineStore({
    init: (): SessionOverviewViewState => ({
      open: false,
      query: '',
      attention: 'all',
      workspaceId: null,
      pinnedOnly: false,
      selectedSessionId: null,
      reviews: {},
    }),
    persist: 'dsh.session-overview.view.v1',
    actions: {
      setOpen: (draft, open: boolean) => { draft.open = open },
      setBeaconPosition: (draft, position: OverviewBeaconPosition) => { draft.beaconPosition = position },
      setQuery: (draft, query: string) => { draft.query = query },
      setAttention: (draft, attention: OverviewAttentionFilter) => { draft.attention = attention },
      setWorkspaceId: (draft, workspaceId: string | null) => { draft.workspaceId = workspaceId },
      setPinnedOnly: (draft, pinnedOnly: boolean) => { draft.pinnedOnly = pinnedOnly },
      selectSession: (draft, sessionId: string | null) => { draft.selectedSessionId = sessionId },
      togglePinned: (draft, sessionId: string) => {
        const review = reviewOf(draft, sessionId)
        if (review.pinned === true) delete review.pinned
        else review.pinned = true
        removeEmptyReview(draft, sessionId)
      },
      setSnoozedUntil: (draft, sessionId: string, until: number | undefined) => {
        const review = reviewOf(draft, sessionId)
        if (until === undefined) delete review.snoozedUntil
        else review.snoozedUntil = until
        removeEmptyReview(draft, sessionId)
      },
      setBookmark: (draft, sessionId: string, bookmark: string | undefined) => {
        const review = reviewOf(draft, sessionId)
        const normalized = bookmark?.trim()
        if (normalized === undefined || normalized === '') delete review.bookmark
        else review.bookmark = normalized
        removeEmptyReview(draft, sessionId)
      },
      markViewed: (draft, sessionId: string, seq: number) => {
        reviewOf(draft, sessionId).lastViewedSeq = seq
      },
      retainSessions: (draft, sessionIds: readonly string[], now: number) => {
        const retained = new Set(sessionIds)
        draft.reviews = Object.fromEntries(
          Object.entries(draft.reviews)
            .filter(([sessionId]) => retained.has(sessionId))
            .map(([sessionId, review]) => {
              if (review.snoozedUntil !== undefined && review.snoozedUntil <= now) {
                const { snoozedUntil: _expired, ...rest } = review
                return [sessionId, rest] as const
              }
              return [sessionId, review] as const
            })
            .filter(([, review]) => Object.keys(review).length > 0),
        )
        if (draft.selectedSessionId !== null && !retained.has(draft.selectedSessionId)) {
          draft.selectedSessionId = null
        }
      },
    },
  })
}
