import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('ConfirmDialog', () => {
  it('shows title, message, and the confirm label', () => {
    render(
      <ConfirmDialog
        open
        title="删除会话"
        message="删除会话「测试」？对应的 pi 会话文件将永久删除。"
        confirmLabel="common:sidebar.delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('删除会话')).toBeTruthy()
    expect(screen.getByText('common:sidebar.delete')).toBeTruthy()
  })

  it('runs onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog open title="t" message="m" confirmLabel="确定" onConfirm={onConfirm} onCancel={() => {}} />,
    )
    fireEvent.click(screen.getByText('确定'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('runs onCancel on Escape and when clicking the overlay', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(screen.getByRole('presentation'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('does not confirm via Enter while busy', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open title="t" message="m" busy onConfirm={onConfirm} onCancel={() => {}} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays open until the caller clears open state', () => {
    const { rerender } = render(
      <ConfirmDialog open title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<ConfirmDialog open={false} title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
