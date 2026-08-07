import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectContextMenuPortal } from './project-context-menu'

const invokeMock = vi.fn(async (_method: unknown, _req?: unknown) => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: unknown, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(async () => {}),
}))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({ recentProjects: [], currentWorkspace: null, setWorkspace: () => {} }),
    setState: () => {},
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const BATCH = 'common:sidebar.batchArchive'
const RUN = 'common:sidebar.batchArchiveRun'
const MENU = { x: 10, y: 10, path: '/proj/A', name: 'A', hasArchivable: true }
const EMPTY_MENU = { x: 10, y: 10, path: '/proj/A', name: 'A', hasArchivable: false }

describe('ProjectContextMenuPortal batch archive', () => {
  afterEach(() => {
    invokeMock.mockClear()
  })

  it('opens the dialog when clicking 批量归档 and keeps it open after the menu closes', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ProjectContextMenuPortal menu={MENU} onClose={onClose} onListChange={() => {}} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })

    // 菜单关闭，但对话框仍然打开（回归点：之前 dialog 随菜单一起卸载，永远看不见）
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    rerender(<ProjectContextMenuPortal menu={null} onClose={onClose} onListChange={() => {}} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes via backdrop click and Escape', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ProjectContextMenuPortal menu={MENU} onClose={onClose} onListChange={() => {}} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })
    rerender(<ProjectContextMenuPortal menu={null} onClose={onClose} onListChange={() => {}} />)

    // Escape 关闭
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    // 重新打开后点 backdrop 关闭
    rerender(<ProjectContextMenuPortal menu={MENU} onClose={onClose} onListChange={() => {}} />)
    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })
    rerender(<ProjectContextMenuPortal menu={null} onClose={onClose} onListChange={() => {}} />)
    const backdrop = document.body.querySelector('[role="presentation"]')
    expect(backdrop).toBeTruthy()
    await act(async () => {
      fireEvent.pointerDown(backdrop as Element)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submits the archiveBatch IPC with the selected rule and closes on done', async () => {
    invokeMock.mockResolvedValue({ ok: true, archived: 3 })
    const onClose = vi.fn()
    const onListChange = vi.fn()
    const { rerender } = render(
      <ProjectContextMenuPortal menu={MENU} onClose={onClose} onListChange={onListChange} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByText(BATCH))
    })
    rerender(<ProjectContextMenuPortal menu={null} onClose={onClose} onListChange={onListChange} />)

    const runButton = screen.getByText(RUN) as HTMLButtonElement
    // 默认 before 模式：未选日期时按钮禁用
    expect(runButton.disabled).toBe(true)

    await act(async () => {
      fireEvent.change(document.querySelector('input[type="date"]') as Element, {
        target: { value: '2026-01-01' },
      })
    })
    expect((screen.getByText(RUN) as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByText(RUN))
    })
    expect(invokeMock).toHaveBeenCalledWith('session.archiveBatch', {
      workspaceId: '/proj/A',
      before: new Date('2026-01-01T23:59:59.999').getTime(),
    })
    // 关键：刷新必须携带被归档项目的路径，而不是无参刷新当前工作区
    expect(onListChange).toHaveBeenCalledWith('/proj/A')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides 批量归档 when the project has no archivable sessions', async () => {
    const { rerender } = render(
      <ProjectContextMenuPortal menu={EMPTY_MENU} onClose={() => {}} onListChange={() => {}} />,
    )
    expect(screen.queryByText('common:sidebar.batchArchive')).toBeNull()
    // 其他菜单项（如移除项目）仍然可见
    expect(screen.getByText('common:sidebar.removeFromList')).toBeTruthy()
    rerender(<ProjectContextMenuPortal menu={null} onClose={() => {}} onListChange={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
