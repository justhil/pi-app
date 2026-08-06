import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SandboxContextMenuPortal } from './sandbox-context-menu'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({ currentWorkspace: null, setWorkspace: () => {}, clearTimeline: () => {}, setCurrentSession: () => {}, loadHistoryItems: () => {}, setHistoryMeta: () => {} }),
    setState: () => {},
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const BATCH = 'common:sidebar.batchArchive'
const MENU = { x: 10, y: 10, path: '/sandbox-workspaces/abc', label: '临时对话 abc', sessionFile: '/sandbox-workspaces/abc/s.jsonl' }

describe('SandboxContextMenuPortal batch archive', () => {
  afterEach(() => {
    invokeMock.mockClear()
  })

  it('offers 批量归档 in the right-click menu and keeps the dialog open after menu close', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <SandboxContextMenuPortal menu={MENU} onClose={onClose} onListChange={() => {}} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    // 菜单关闭后对话框保持打开（回归点）
    rerender(<SandboxContextMenuPortal menu={null} onClose={onClose} onListChange={() => {}} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('submits the sandbox archiveBatch IPC and refreshes', async () => {
    invokeMock.mockResolvedValue({ ok: true, archived: 2 })
    const onListChange = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <SandboxContextMenuPortal menu={MENU} onClose={onClose} onListChange={onListChange} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })
    rerender(<SandboxContextMenuPortal menu={null} onClose={onClose} onListChange={onListChange} />)

    await act(async () => {
      fireEvent.change(document.querySelector('input[type="date"]') as Element, {
        target: { value: '2026-01-01' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.batchArchiveRun'))
    })
    expect(invokeMock).toHaveBeenCalledWith('workspace.sandbox.archiveBatch', {
      before: new Date('2026-01-01T23:59:59.999').getTime(),
    })
    expect(onListChange).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
