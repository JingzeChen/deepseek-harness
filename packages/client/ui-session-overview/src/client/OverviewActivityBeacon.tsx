/** Floating realtime entry for Session activity and attention. */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  IconFullscreenOutline16,
  IconListPenOutline16,
  IconPlayOutline16,
  IconWarningOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionOverviewRow } from './derive.ts'
import type { OverviewBeaconPosition } from './stores.ts'
import css from './OverviewActivityBeacon.module.css'

const DRAG_THRESHOLD = 4
const EDGE_MARGIN = 12

interface DragState {
  pointerId: number
  originX: number
  originY: number
  startX: number
  startY: number
  latestX: number
  latestY: number
  moved: boolean
}

type BeaconStyle = CSSProperties & { '--beacon-x': string }

interface DocumentPictureInPictureApi {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
}

type PointerCaptureTarget = Omit<
  HTMLButtonElement,
  'hasPointerCapture' | 'releasePointerCapture' | 'setPointerCapture'
> & {
  hasPointerCapture?: (pointerId: number) => boolean
  releasePointerCapture?: (pointerId: number) => void
  setPointerCapture?: (pointerId: number) => void
}

function pictureInPictureApi(): DocumentPictureInPictureApi | undefined {
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture
}

function copyStyles(source: Document, target: Document): void {
  for (const node of source.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      target.head.append(link)
    } else {
      target.head.append(node.cloneNode(true))
    }
  }
}

function syncTheme(source: Document, target: Document): void {
  const dark = source.body.getAttribute('data-ds-dark-theme')
  if (dark === null) target.body.removeAttribute('data-ds-dark-theme')
  else target.body.setAttribute('data-ds-dark-theme', dark)
  target.documentElement.lang = source.documentElement.lang
  target.documentElement.style.colorScheme = getComputedStyle(source.documentElement).colorScheme
  target.body.style.margin = '0'
  target.body.style.overflow = 'hidden'
  target.body.style.fontFamily = getComputedStyle(source.body).fontFamily
}

function viewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function clampCenter(value: number, viewport: number, diameter: number): number {
  const inset = diameter / 2 + EDGE_MARGIN
  return Math.min(Math.max(value, inset), Math.max(inset, viewport - inset))
}

function validPosition(position: OverviewBeaconPosition | undefined): position is OverviewBeaconPosition {
  return position !== undefined
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && position.x >= 0
    && position.x <= 1
    && position.y >= 0
    && position.y <= 1
}

/** Realtime activity beacon inputs derived by the workbench owner. */
export interface OverviewActivityBeaconProps {
  rows: readonly SessionOverviewRow[]
  position: OverviewBeaconPosition | undefined
  onPositionChange: (position: OverviewBeaconPosition) => void
  onOpen: () => void
  t: TranslateNS<'sessionOverview'>
}

/** Render the edge beacon and its hover/focus activity preview. */
export function OverviewActivityBeacon({ rows, position, onPositionChange, onOpen, t }: OverviewActivityBeaconProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState(viewportSize)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [pipError, setPipError] = useState(false)
  const actionRows = rows.filter(row => row.attention === 'needs-action')
  const runningRows = rows.filter(row => row.attention === 'running')
  const state = actionRows.length > 0 ? 'needs-action' : runningRows.length > 0 ? 'running' : 'idle'
  const ariaLabel = state === 'needs-action'
    ? t('beacon.aria.needsAction')
    : state === 'running'
      ? t('beacon.aria.running')
      : t('beacon.aria.idle')
  const liveLabel = state === 'needs-action'
    ? t('beacon.live.needsAction')
    : state === 'running'
      ? t('beacon.live.running')
      : t('beacon.live.idle')
  const diameter = viewport.width <= 700 ? 52 : 56
  const restoredPoint = validPosition(position)
    ? {
      x: clampCenter(position.x * viewport.width, viewport.width, diameter),
      y: clampCenter(position.y * viewport.height, viewport.height, diameter),
    }
    : null
  const defaultPoint = {
    x: viewport.width - (viewport.width <= 700 ? 14 : 22) - diameter / 2,
    y: viewport.height / 2,
  }
  const point = dragPoint ?? restoredPoint ?? defaultPoint
  const previewSide = point.x < viewport.width / 2 ? 'right' : 'left'
  const rootStyle: BeaconStyle = {
    '--beacon-x': `${point.x}px`,
    left: point.x - diameter / 2,
    top: point.y - diameter / 2,
    right: 'auto',
    transform: 'none',
  }

  useEffect(() => {
    const onResize = () => { setViewport(viewportSize()) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    if (pipWindow === null) return
    const updateTheme = () => { syncTheme(document, pipWindow.document) }
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => {
      observer.disconnect()
      if (!pipWindow.closed) pipWindow.close()
    }
  }, [pipWindow])

  const openPictureInPicture = async () => {
    const api = pictureInPictureApi()
    if (api === undefined) return
    setPipError(false)
    if (pipWindow !== null && !pipWindow.closed) {
      pipWindow.focus()
      return
    }
    try {
      const detached = await api.requestWindow({ width: 336, height: 220 })
      detached.document.title = t('beacon.pip.title')
      copyStyles(document, detached.document)
      syncTheme(document, detached.document)
      detached.addEventListener('pagehide', () => {
        setPipWindow(current => current === detached ? null : current)
      }, { once: true })
      setPipWindow(detached)
    } catch {
      setPipError(true)
    }
  }

  const returnToWorkbench = () => {
    window.focus()
    onOpen()
    if (pipWindow !== null && !pipWindow.closed) pipWindow.close()
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: rect.left + rect.width / 2,
      startY: rect.top + rect.height / 2,
      latestX: rect.left + rect.width / 2,
      latestY: rect.top + rect.height / 2,
      moved: false,
    }
    const target = event.currentTarget as PointerCaptureTarget
    target.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.originX
    const deltaY = event.clientY - drag.originY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return
    event.preventDefault()
    drag.moved = true
    drag.latestX = clampCenter(drag.startX + deltaX, viewport.width, diameter)
    drag.latestY = clampCenter(drag.startY + deltaY, viewport.height, diameter)
    setDragPoint({ x: drag.latestX, y: drag.latestY })
  }

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const target = event.currentTarget as PointerCaptureTarget
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture?.(event.pointerId)
    }
    if (!cancelled && drag.moved) {
      suppressClickRef.current = true
      onPositionChange({ x: drag.latestX / viewport.width, y: drag.latestY / viewport.height })
    }
    dragRef.current = null
    setDragPoint(null)
    setDragging(false)
  }

  return (
    <div
      ref={rootRef}
      className={css.root}
      style={rootStyle}
      data-session-activity-beacon
      data-state={state}
      data-dragging={dragging || undefined}
      data-preview-side={previewSide}
    >
      <div className={css.preview} data-activity-preview>
        <header>
          <span className={css.previewTitle}>
            <small>{t('beacon.kicker')}</small>
            <strong>{t(`beacon.title.${state}`)}</strong>
          </span>
          {pictureInPictureApi() !== undefined && (
            <Tooltip label={t(pipWindow === null ? 'beacon.pip.open' : 'beacon.pip.focus')} side="top">
              <button
                type="button"
                className={css.pipButton}
                aria-label={t(pipWindow === null ? 'beacon.pip.open' : 'beacon.pip.focus')}
                onClick={() => { void openPictureInPicture() }}
              >
                <IconFullscreenOutline16 />
              </button>
            </Tooltip>
          )}
        </header>
        <div className={css.sessionList}>
          {actionRows.slice(0, 3).map(row => (
            <div key={row.id} className={css.session} data-kind="needs-action">
              <IconWarningOutline16 />
              <span>
                <strong>{row.title}</strong>
                <small>{t('beacon.needsYou')}</small>
              </span>
            </div>
          ))}
          {runningRows.slice(0, 3).map(row => (
            <div key={row.id} className={css.session} data-kind="running">
              <span className={css.liveDot} />
              <span>
                <strong>{row.title}</strong>
                <small>{t('beacon.running')}</small>
              </span>
            </div>
          ))}
          {actionRows.length === 0 && runningRows.length === 0 && (
            <p>{t('beacon.quiet')}</p>
          )}
        </div>
        {pipError && <p className={css.pipError} role="alert">{t('beacon.pip.failed')}</p>}
      </div>

      {actionRows.length > 0 && (
        <span className={css.attentionFlag} data-needs-action-flag aria-hidden="true">
          <IconWarningOutline16 />
          {t('beacon.needsYou')}
        </span>
      )}

      <button
        type="button"
        className={css.button}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => { finishDrag(event, false) }}
        onPointerCancel={(event) => { finishDrag(event, true) }}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            event.preventDefault()
            return
          }
          onOpen()
        }}
      >
        <span className={css.orbit} aria-hidden="true">
          {runningRows.slice(0, 4).map((row, index) => (
            <span key={row.id} data-index={index} />
          ))}
        </span>
        <span className={css.icon} aria-hidden="true">
          {state === 'needs-action'
            ? <IconWarningOutline16 size={20} />
            : state === 'running'
              ? <IconPlayOutline16 size={20} />
              : <IconListPenOutline16 size={20} />}
        </span>
      </button>

      <span className={css.srOnly} role="status" aria-live="polite">{liveLabel}</span>
      {pipWindow !== null && !pipWindow.closed && createPortal(
        <PictureInPictureActivity
          actionRows={actionRows}
          runningRows={runningRows}
          state={state}
          onOpen={returnToWorkbench}
          t={t}
        />,
        pipWindow.document.body,
      )}
    </div>
  )
}

function PictureInPictureActivity({ actionRows, runningRows, state, onOpen, t }: {
  actionRows: readonly SessionOverviewRow[]
  runningRows: readonly SessionOverviewRow[]
  state: 'idle' | 'running' | 'needs-action'
  onOpen: () => void
  t: OverviewActivityBeaconProps['t']
}) {
  const visibleRows = [...actionRows, ...runningRows].slice(0, 3)
  return (
    <main className={css.pipSurface} data-state={state}>
      <header className={css.pipHeader}>
        <span className={css.pipBeacon} aria-hidden="true">
          {state === 'needs-action'
            ? <IconWarningOutline16 size={20} />
            : state === 'running'
              ? <IconPlayOutline16 size={20} />
              : <IconListPenOutline16 size={20} />}
        </span>
        <span>
          <small>{t('beacon.kicker')}</small>
          <strong>{t(`beacon.title.${state}`)}</strong>
        </span>
      </header>
      <div className={css.pipSessions}>
        {visibleRows.length === 0
          ? <p>{t('beacon.quiet')}</p>
          : visibleRows.map(row => (
            <button key={row.id} type="button" onClick={onOpen}>
              <span data-kind={row.attention === 'needs-action' ? 'needs-action' : 'running'} />
              <strong>{row.title}</strong>
              <small>{t(row.attention === 'needs-action' ? 'beacon.needsYou' : 'beacon.running')}</small>
            </button>
          ))}
      </div>
      <button type="button" className={css.pipOpen} onClick={onOpen}>{t('beacon.pip.openOverview')}</button>
    </main>
  )
}
