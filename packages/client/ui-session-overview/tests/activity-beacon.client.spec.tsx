// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OverviewActivityBeacon } from '../src/client/OverviewActivityBeacon.tsx'
import type { SessionOverviewRow } from '../src/client/derive.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

function row(overrides: Partial<SessionOverviewRow> = {}): SessionOverviewRow {
  return {
    id: 'session' as SessionOverviewRow['id'],
    title: '后台构建',
    attention: 'running',
    reason: 'running',
    runningDescendants: 0,
    updatedAt: 0,
    lastMeaningfulAt: 0,
    lastMeaningfulSeq: 1,
    openTools: [],
    openToolsOmitted: 0,
    todo: null,
    context: { task: { text: '后台构建', provenance: 'recorded' }, completed: [] },
    pinned: false,
    snoozed: false,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'documentPictureInPicture')
  vi.restoreAllMocks()
})

describe('OverviewActivityBeacon', () => {
  it('persists a clamped viewport-relative position without opening after a drag', () => {
    const onPositionChange = vi.fn()
    const onOpen = vi.fn()
    const { container } = render(
      <OverviewActivityBeacon
        rows={[row()]}
        position={undefined}
        onPositionChange={onPositionChange}
        onOpen={onOpen}
        t={t}
      />,
    )
    const root = container.querySelector<HTMLElement>('[data-session-activity-beacon]')!
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 900, y: 350, left: 900, top: 350, right: 956, bottom: 406,
      width: 56, height: 56, toJSON: () => ({}),
    })
    const button = screen.getByRole('button', { name: zh['beacon.aria.running'] })
    fireEvent.pointerDown(button, { button: 0, pointerId: 7, clientX: 928, clientY: 378 })
    fireEvent.pointerMove(button, { pointerId: 7, clientX: 500, clientY: 200 })
    fireEvent.pointerUp(button, { pointerId: 7, clientX: 500, clientY: 200 })
    expect(onPositionChange).toHaveBeenCalledWith({
      x: 500 / window.innerWidth,
      y: 200 / window.innerHeight,
    })
    fireEvent.click(button)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders live activity in Document Picture-in-Picture and returns to the workbench', async () => {
    const pipDocument = document.implementation.createHTMLDocument('')
    const close = vi.fn()
    const focus = vi.fn()
    const detached = {
      document: pipDocument,
      closed: false,
      close,
      focus,
      addEventListener: vi.fn(),
    } as unknown as Window
    const requestWindow = vi.fn(async () => detached)
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow },
    })
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const onOpen = vi.fn()
    render(
      <OverviewActivityBeacon
        rows={[row({ attention: 'needs-action', reason: 'approval', title: '等待批准' })]}
        position={undefined}
        onPositionChange={vi.fn()}
        onOpen={onOpen}
        t={t}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['beacon.pip.open'] }))
      await Promise.resolve()
    })
    expect(requestWindow).toHaveBeenCalledWith({ width: 336, height: 220 })
    expect(pipDocument.title).toBe(zh['beacon.pip.title'])
    expect(pipDocument.body.style.margin).toBe('0px')
    expect(within(pipDocument.body).getByText('等待批准')).toBeDefined()
    expect(within(pipDocument.body).getByText(zh['beacon.needsYou'])).toBeDefined()
    const openOverview = [...pipDocument.body.querySelectorAll('button')]
      .find(button => button.textContent === zh['beacon.pip.openOverview'])
    expect(openOverview).toBeDefined()
    openOverview!.click()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
