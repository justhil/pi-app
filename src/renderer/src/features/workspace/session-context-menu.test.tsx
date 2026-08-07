import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContextMenuPortal } from './session-context-menu'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      currentSessionId: null,
      setCurrentSession: () => {},
      clearTimeline: () => {},
      loadHistoryItems: () => {},
      setHistoryMeta: () => {},
    }),
    setState: () => {},
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const MENU = {
  x: 10,
  y: 10,
  target: {
    sessionId: 's1',
    sessionFile: '/proj/a/s1.jsonl',
    title: '旧标题',
    workspacePath: '/proj/a',
  },
}

describe('SessionContextMenuPortal mutations refresh the owning workspace', () => {
  afterEach(() => {
    invokeMock.mockClear()
  })

  it('rename reports the new title for a local in-place sidebar update', async () => {
    invokeMock.mockResolvedValue({ ok: true, title: '新标题' })
    const onSessionRenamed = vi.fn()
    const onSessionsChange = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <SessionContextMenuPortal
        menu={MENU}
        onClose={onClose}
        onSessionsChange={onSessionsChange}
        onSessionRenamed={onSessionRenamed}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    rerender(
      <SessionContextMenuPortal
        menu={null}
        onClose={onClose}
        onSessionsChange={onSessionsChange}
        onSessionRenamed={onSessionRenamed}
      />,
    )

    await act(async () => {
      fireEvent.change(document.querySelector('input[type="text"]') as Element, {
        target: { value: '新标题' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })

    expect(invokeMock).toHaveBeenCalledWith('session.rename', {
      sessionId: 's1',
      sessionFile: '/proj/a/s1.jsonl',
      title: '新标题',
      workspaceId: '/proj/a',
    })
    expect(onSessionRenamed).toHaveBeenCalledWith({
      sessionFile: '/proj/a/s1.jsonl',
      title: '新标题',
      workspacePath: '/proj/a',
    })
    // 重命名不再触发整列表重拉
    expect(onSessionsChange).not.toHaveBeenCalled()
  })

  it('delete refreshes the owning workspace', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const onSessionsChange = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <SessionContextMenuPortal
        menu={MENU}
        onClose={onClose}
        onSessionsChange={onSessionsChange}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
    })
    rerender(<SessionContextMenuPortal menu={null} onClose={onClose} onSessionsChange={onSessionsChange} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.delete'))
    })

    expect(invokeMock).toHaveBeenCalledWith('session.delete', {
      sessionId: 's1',
      sessionFile: '/proj/a/s1.jsonl',
    })
    expect(onSessionsChange).toHaveBeenCalledWith('/proj/a')
    // 确认后对话框立即关闭，不等到删除 IPC 返回
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('archive refreshes the owning workspace', async () => {
    invokeMock.mockResolvedValue({ ok: true })
    const onSessionsChange = vi.fn()
    render(<SessionContextMenuPortal menu={MENU} onClose={() => {}} onSessionsChange={onSessionsChange} />)

    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.archive'))
    })

    expect(invokeMock).toHaveBeenCalledWith('session.archive', {
      sessionFile: '/proj/a/s1.jsonl',
      archived: true,
    })
    expect(onSessionsChange).toHaveBeenCalledWith('/proj/a')
  })
})
