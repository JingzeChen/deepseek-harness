// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { PendingInteractionRequest } from '@deepseek-ai/dsh-client-runtime/client'
import {
  InteractionPanel, type InteractionPanelProps, SteerControl, type SteerControlProps,
} from '../src/client/InteractionPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t: InteractionPanelProps['t'] = makeTranslate(zh)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderInteraction(
  request: PendingInteractionRequest,
  onRespond: InteractionPanelProps['onRespond'] = vi.fn(async () => {}),
) {
  render(<InteractionPanel request={request} busy={false} onRespond={onRespond} t={t} />)
  return onRespond
}

describe('DSH Beacon interaction panel', () => {
  it('answers approvals and shows the explicit reason or bounded fallback', () => {
    const onRespond = renderInteraction({
      kind: 'approval', key: 'a:1', status: 'approval',
      payload: { approvalId: 'approval' as never, toolName: 'terminal', reason: '需要写入文件' },
    })
    expect(screen.getByText('需要写入文件')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.reject'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.allowOnce'] }))
    expect(onRespond).toHaveBeenNthCalledWith(1, 'a:1', { kind: 'approval', outcome: 'rejected' })
    expect(onRespond).toHaveBeenNthCalledWith(2, 'a:1', { kind: 'approval', outcome: 'allowed-once' })

    cleanup()
    renderInteraction({
      kind: 'approval', key: 'a:2', status: 'approval',
      payload: { approvalId: 'approval-2' as never, toolName: 'bash' },
    })
    expect(screen.getByText('工具 bash 请求执行授权')).toBeDefined()
  })

  it('renders plan detail and routes discuss, decline, and approval', () => {
    const onRespond = renderInteraction({
      kind: 'question', key: 'q:plan', status: 'plan-review',
      payload: { questions: [{
        id: 'plan', question: '批准该计划？', detail: '# 执行计划',
        options: [{ label: 'Approve', description: '开始执行' }, { label: 'Revise', description: '继续修改' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }] },
    })
    expect(screen.getByText('# 执行计划')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.discuss'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.planDecline'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.planApprove'] }))
    expect(onRespond).toHaveBeenNthCalledWith(1, 'q:plan', { kind: 'question-cancel' })
    expect(onRespond).toHaveBeenNthCalledWith(2, 'q:plan', {
      kind: 'question', answer: { answers: [{ id: 'plan', selected: ['Revise'] }] },
    })
    expect(onRespond).toHaveBeenNthCalledWith(3, 'q:plan', {
      kind: 'question', answer: { answers: [{ id: 'plan', selected: ['Approve'] }] },
    })
  })

  it.each([
    ['empty batch', { questions: [] }],
    ['missing intent', { questions: [{ id: 'plan', question: 'Review?' }] }],
    ['missing approval option', { questions: [{
      id: 'plan', question: 'Review?', detail: '# Plan', options: [{ label: 'Revise' }],
      intent: { kind: 'plan-review' as const, approve: 'Approve' },
    }] }],
  ])('degrades a mismatched %s descriptor to the generic question flow', (_name, payload) => {
    renderInteraction({ kind: 'question', key: 'q:mismatch', status: 'plan-review', payload })
    expect(screen.getByText(zh['interaction.question'])).toBeDefined()
  })

  it('renders a plan without a decline option', () => {
    const onRespond = renderInteraction({
      kind: 'question', key: 'q:approve-only', status: 'plan-review',
      payload: { questions: [{
        id: 'plan', question: 'Approve?', detail: '# Plan', options: [{ label: 'Approve' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }] },
    })
    expect(screen.queryByRole('button', { name: zh['interaction.planDecline'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.planApprove'] }))
    expect(onRespond).toHaveBeenCalled()
  })

  it('falls back to the generic flow for a non-renderable plan and submits all answer forms', () => {
    const onRespond = renderInteraction({
      kind: 'question', key: 'q:questions', status: 'plan-review',
      payload: { questions: [
        {
          id: 'mode', header: '执行模式', question: '选择模式', detail: '可选择多个', multiSelect: true,
          options: [{ label: 'Fast', description: '快速' }, { label: 'Safe' }],
          intent: { kind: 'plan-review', approve: 'Fast' },
        },
        { id: 'name', question: '输入名称' },
        { id: 'optional', question: '可选问题', options: [{ label: 'One' }] },
      ] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.answer'] }))
    expect(screen.getByRole('alert').textContent).toBe(zh['interaction.incomplete'])

    const mode = screen.getByRole('group', { name: '执行模式' })
    fireEvent.click(within(mode).getByRole('checkbox', { name: 'Fast' }))
    fireEvent.click(within(mode).getByRole('checkbox', { name: 'Safe' }))
    fireEvent.click(within(mode).getByRole('checkbox', { name: 'Fast' }))
    fireEvent.click(within(mode).getByRole('checkbox', { name: 'Fast' }))
    fireEvent.change(within(mode).getByPlaceholderText(zh['interaction.customPlaceholder']), {
      target: { value: 'Balanced' },
    })
    const name = screen.getByRole('group', { name: '输入名称' })
    fireEvent.change(within(name).getByPlaceholderText(zh['interaction.customPlaceholder']), {
      target: { value: '  Ada  ' },
    })
    const optional = screen.getByRole('group', { name: '可选问题' })
    fireEvent.click(within(optional).getByRole('checkbox', { name: zh['interaction.skip'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.answer'] }))
    expect(onRespond).toHaveBeenCalledWith('q:questions', {
      kind: 'question',
      answer: { answers: [
        { id: 'mode', selected: ['Safe', 'Fast'], custom: 'Balanced' },
        { id: 'name', selected: [], custom: 'Ada' },
        { id: 'optional', selected: [] },
      ] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.discuss'] }))
    expect(onRespond).toHaveBeenLastCalledWith('q:questions', { kind: 'question-cancel' })
  })

  it('handles single-choice replacement and restores a skipped question', () => {
    const onRespond = renderInteraction({
      kind: 'question', key: 'q:single', status: 'question',
      payload: { questions: [{
        id: 'choice', question: 'Pick one', options: [{ label: 'One' }, { label: 'Two' }],
      }] },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'One' }))
    fireEvent.change(screen.getByPlaceholderText(zh['interaction.customPlaceholder']), {
      target: { value: 'Custom' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: zh['interaction.skip'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh['interaction.skip'] }))
    fireEvent.click(screen.getByRole('radio', { name: 'Two' }))
    fireEvent.click(screen.getByRole('button', { name: zh['interaction.answer'] }))
    expect(onRespond).toHaveBeenCalledWith('q:single', {
      kind: 'question', answer: { answers: [{ id: 'choice', selected: ['Two'] }] },
    })
  })

  it('disables decisions while another action is pending', () => {
    render(<InteractionPanel request={{
      kind: 'approval', key: 'a:busy', status: 'approval',
      payload: { approvalId: 'approval' as never, toolName: 'terminal' },
    }} busy onRespond={vi.fn(async () => {})} t={t} />)
    expect(screen.getByRole('button', { name: zh['interaction.reject'] }).hasAttribute('disabled')).toBe(true)
  })

  it('contains a rejected action promise without an unhandled rejection', async () => {
    renderInteraction({
      kind: 'approval', key: 'a:rejected', status: 'approval',
      payload: { approvalId: 'approval' as never, toolName: 'terminal' },
    }, vi.fn(async () => { throw new Error('settled') }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['interaction.reject'] }))
      await Promise.resolve()
    })
  })
})


describe('DSH Beacon steering control', () => {
  it('sends trimmed text and clears only after success', async () => {
    const onSteer = vi.fn(async () => {})
    const props: SteerControlProps = { busy: false, onSteer, t }
    render(<SteerControl {...props} />)
    const input = screen.getByPlaceholderText(zh['steer.placeholder'])
    const send = screen.getByRole('button', { name: zh['steer.send'] })
    expect(send.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input, { target: { value: '  inspect logs  ' } })
    await act(async () => { fireEvent.click(send); await Promise.resolve() })
    expect(onSteer).toHaveBeenCalledWith('inspect logs')
    expect((input as HTMLTextAreaElement).value).toBe('')
  })

  it('retains text after failure and ignores an empty direct send', async () => {
    const onSteer = vi.fn(async () => { throw new Error('closed') })
    render(<SteerControl busy={false} onSteer={onSteer} t={t} />)
    const input = screen.getByPlaceholderText(zh['steer.placeholder'])
    fireEvent.change(input, { target: { value: 'continue' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['steer.send'] }))
      await Promise.resolve()
    })
    expect((input as HTMLTextAreaElement).value).toBe('continue')
  })
})
