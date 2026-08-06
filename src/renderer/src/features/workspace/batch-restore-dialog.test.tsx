import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BatchRestoreDialog } from './batch-restore-dialog'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const FILES = ['/p/.pi/sessions/a.jsonl', '/p/.pi/sessions/b.jsonl']

describe('BatchRestoreDialog', () => {
  afterEach(() => {
    invokeMock.mockClear()
  })

  it('defaults to 0 (restore all) and submits session.restoreBatch', async () => {
    invokeMock.mockResolvedValue({ ok: true, restored: 2 })
    const onDone = vi.fn()
    render(
      <BatchRestoreDialog open title="demo" sessionFiles={FILES} onCancel={() => {}} onDone={onDone} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.batchRestoreRun'))
    })
    expect(invokeMock).toHaveBeenCalledWith('session.restoreBatch', {
      sessionFiles: FILES,
      keepRecent: 0,
    })
    expect(onDone).toHaveBeenCalledWith(2)
  })

  it('sends the typed N (keep N most recently archived)', async () => {
    invokeMock.mockResolvedValue({ ok: true, restored: 1 })
    const onDone = vi.fn()
    render(
      <BatchRestoreDialog open title="demo" sessionFiles={FILES} onCancel={() => {}} onDone={onDone} />,
    )
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.batchRestoreRun'))
    })
    expect(invokeMock).toHaveBeenCalledWith('session.restoreBatch', {
      sessionFiles: FILES,
      keepRecent: 3,
    })
  })

  it('ignores non-digit keyboard input', async () => {
    render(
      <BatchRestoreDialog open title="demo" sessionFiles={FILES} onCancel={() => {}} onDone={() => {}} />,
    )
    const input = screen.getByPlaceholderText('0') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: '12a3' } })
    })
    expect(input.value).toBe('123')
  })

  it('closes via Escape and does not submit when canceled', async () => {
    const onCancel = vi.fn()
    render(
      <BatchRestoreDialog open title="demo" sessionFiles={FILES} onCancel={onCancel} onDone={() => {}} />,
    )
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
