// Keyless assembled-browser proof for DSH Beacon. The scenario
// creates one real Workspace/Session through the ordinary UI but sends no
// model request: deterministic Host projections feed the activity beacon,
// workbench, and Session Context view through the shipped Web roster.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import type {} from '@deepseek-ai/dsh-session-brief'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/session-overview', import.meta.url))
const CONTEXT_EXPECTED = join(SNAPSHOT_DIR, 'context.expected.md')
const WORKBENCH_EXPECTED = join(SNAPSHOT_DIR, 'workbench.expected.md')
const MOBILE_EXPECTED = join(SNAPSHOT_DIR, 'mobile-workbench.expected.md')
const MOBILE_DETAIL_EXPECTED = join(SNAPSHOT_DIR, 'mobile-detail.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: DSH Beacon workbench and Context view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let activityWindow: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const sessions = scaffold.ctx.sessions.list()
    expect(sessions).toHaveLength(1)
    const session = sessions[0]!
    const now = Date.now()
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: 'snapshot-goal' as never,
        revision: 1,
        objective: 'Deliver the Session context summary',
        phase: 'active',
        maxGoalRounds: 3,
      },
      roundsStarted: 0,
      createdAt: now,
      updatedAt: now,
    })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await page.locator('[data-goal-bar]').waitFor({ timeout: 10_000 })
    const todo = session.append('todo/write', {
      todos: [
        { content: 'Derive deterministic context facts', status: 'completed' },
        { content: 'Render the current context', status: 'in_progress' },
        { content: 'Inspect responsive context layout', status: 'pending' },
      ],
    })
    session.append('session/brief', {
      version: 1,
      revision: 1,
      sourceSeq: todo.seq,
      generatedAt: Date.now(),
      task: 'Deliver DSH Beacon with generated interpretation',
      currentGoal: 'Make Session catch-up fast and grounded',
      currentFocus: 'Validate the assembled generated brief UI',
      completed: ['Implemented the bounded brief service'],
      nextStep: 'Inspect the refreshed browser evidence',
      blockers: [],
      provenance: {
        provider: 'snapshot-provider',
        model: 'snapshot-brief-model',
        sourceEventSeqs: [todo.seq],
      },
    }, { ignorable: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows one floating activity beacon without a numeric badge', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-overview-beacon'))
    expect(await page.getByRole('region', { name: 'Session glance', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Expand Session glance', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'DSH Beacon', exact: true }).count()).toBe(0)
    const beacon = page.locator('[data-session-activity-beacon]')
    await beacon.waitFor({ timeout: 15_000 })
    expect(await beacon.getAttribute('data-state')).toBe('idle')
    expect(await beacon.innerText()).not.toMatch(/\d/)
    const beforeDrag = await beacon.boundingBox()
    expect(beforeDrag).not.toBeNull()
    const center = {
      x: beforeDrag!.x + beforeDrag!.width / 2,
      y: beforeDrag!.y + beforeDrag!.height / 2,
    }
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x - 180, center.y + 100, { steps: 4 })
    await page.mouse.up()
    const afterDrag = await beacon.boundingBox()
    expect(afterDrag).not.toBeNull()
    expect(afterDrag!.x).toBeLessThan(beforeDrag!.x - 150)
    expect(afterDrag!.y).toBeGreaterThan(beforeDrag!.y + 70)
    expect(await page.getByRole('dialog', { name: 'DSH Beacon', exact: true }).count()).toBe(0)
    await beacon.getByRole('button').hover()
    const idlePreview = beacon.locator('[data-activity-preview]')
    await idlePreview.waitFor()
    await expect.poll(() => idlePreview.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    const activityWindowOpened = page.context().waitForEvent('page')
    await beacon.getByRole('button', { name: 'Keep visible across windows' }).click()
    activityWindow = await activityWindowOpened
    await activityWindow.setViewportSize({ width: 336, height: 220 })
    await activityWindow.getByText('All Sessions are quiet', { exact: true }).waitFor()
    expect(await activityWindow.getByText('No Sessions are running or waiting for action.', { exact: true }).count()).toBe(1)
    const pipDimensions = await activityWindow.locator('main').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(pipDimensions.scrollWidth).toBe(pipDimensions.clientWidth)
    expect(pipDimensions.scrollHeight).toBe(pipDimensions.clientHeight)
  })

  it('renders the complete current Session context only in its Context tab', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-context-view'))
    const contextTab = page.getByRole('tab', { name: 'Context', exact: true })
    await contextTab.waitFor({ timeout: 10_000 })
    await contextTab.click()
    const context = page.getByRole('region', { name: 'Session context', exact: true })
    const refreshBrief = context.getByRole('button', { name: 'Refresh generated interpretation', exact: true })
    await refreshBrief.waitFor()
    await expect.poll(() => context.innerText(), { timeout: 30_000 }).toContain('Render the current context')
    await expect.poll(() => context.innerText(), { timeout: 30_000 }).toContain('Derive deterministic context facts')
    await expect.poll(() => context.innerText(), { timeout: 30_000 }).toContain('Inspect responsive context layout')
    await expect.poll(() => context.innerText(), { timeout: 30_000 }).toContain('AI summary')
    await expect.poll(() => context.innerText(), { timeout: 30_000 }).toContain('snapshot-provider / snapshot-brief-model')
    const snapshot = await captureStableAria(page, '[role="region"][aria-label="Session context"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONTEXT_EXPECTED, snapshot, MODE)
  })

  it('keeps actions in details and resolves a Host approval through the existing carrier', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-overview-workbench'))
    const session = scaffold.ctx.sessions.list()[0]!
    const agent = scaffold.ctx.agents.get(session.id)
    expect(agent).toBeDefined()
    const approvalTurn = 1 + Math.max(0, ...session.events.flatMap(event => (
      'turn' in event.data && typeof event.data.turn === 'number' ? [event.data.turn] : []
    )))
    session.append('turn/start', { turn: approvalTurn })
    const approvalOutcome = scaffold.ctx.approval.request({
      agent: agent!,
      toolName: 'terminal',
      reason: 'Allow the DSH Beacon snapshot to inspect the Workspace',
    })
    const beacon = page.locator('[data-session-activity-beacon]')
    await expect.poll(() => beacon.getAttribute('data-state')).toBe('needs-action')
    await beacon.locator('[data-needs-action-flag]').getByText('Needs you', { exact: true }).waitFor()
    await activityWindow.getByText('Waiting for your decision', { exact: true }).waitFor()
    await activityWindow.getByText('Needs you', { exact: true }).waitFor()
    await activityWindow.getByRole('button', { name: 'Open DSH Beacon' }).click()
    const dialog = page.getByRole('dialog', { name: 'DSH Beacon', exact: true })
    await dialog.waitFor({ timeout: 10_000 })
    await expect.poll(() => activityWindow.isClosed()).toBe(true)
    const snapshot = await captureStableAria(page, '[role="dialog"][aria-label="DSH Beacon"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WORKBENCH_EXPECTED, snapshot, MODE)

    const table = dialog.getByRole('table', { name: 'DSH Beacon' })
    const scroller = table.getByRole('rowgroup')
    const dimensions = await scroller.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
    expect(await table.getByRole('columnheader').allTextContents()).toEqual([
      'Session', 'Status / current focus', 'Updated',
    ])

    await table.getByRole('row').nth(1).click()
    const details = dialog.getByRole('complementary', { name: 'Current information' })
    await details.getByText('Allow the DSH Beacon snapshot to inspect the Workspace').waitFor()
    expect(await details.getByRole('button').allTextContents()).toEqual([
      'Reject', 'Allow once', 'Open Session', '',
    ])
    await details.getByRole('button', { name: 'Allow once' }).click()
    await expect(approvalOutcome).resolves.toBe('allowed-once')
    session.append('turn/end', { turn: approvalTurn, reason: { kind: 'completed' } })
    await expect.poll(() => details.getByRole('button', { name: 'Allow once' }).count()).toBe(0)
  })

  it('uses separate list and detail pages inside a narrow viewport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-overview-mobile'))
    await page.getByRole('button', { name: 'Close DSH Beacon' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-session-activity-beacon]').getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'DSH Beacon', exact: true })
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844)
    const snapshot = await captureStableAria(page, '[role="dialog"][aria-label="DSH Beacon"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MOBILE_EXPECTED, snapshot, MODE)

    const table = dialog.getByRole('table', { name: 'DSH Beacon' })
    await table.getByRole('row').nth(0).click()
    const details = dialog.getByRole('complementary', { name: 'Current information' })
    await details.getByRole('button', { name: 'Back to Sessions', exact: true }).waitFor()
    expect(await table.isVisible()).toBe(false)
    expect(await details.isVisible()).toBe(true)
    const detailSnapshot = await captureStableAria(page, '[role="dialog"][aria-label="DSH Beacon"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MOBILE_DETAIL_EXPECTED, detailSnapshot, MODE)
    await details.getByRole('button', { name: 'Back to Sessions', exact: true }).click()
    expect(await table.isVisible()).toBe(true)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'context.expected.md', 'mobile-detail.expected.md', 'mobile-workbench.expected.md', 'workbench.expected.md',
    ])
  })
})
