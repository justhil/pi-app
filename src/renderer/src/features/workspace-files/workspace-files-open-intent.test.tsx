import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useUIStore } from '@renderer/stores/ui-store'

const readText = vi.fn(async () => 'file content')
const listDir = vi.fn(async () => [])

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ ok: true })) },
}))

vi.mock('@renderer/features/workspace-files/use-workspace-fs', () => ({
  useWorkspaceFs: () => ({ listDir, readText }),
}))

vi.mock('@renderer/features/workspace-files/file-preview-router', () => ({
  FilePreviewRouter: ({ relativePath }: { relativePath: string }) => (
    <div data-testid="preview-router">{relativePath}</div>
  ),
}))

vi.mock('@renderer/features/workspace-files/file-tree', () => ({
  FileTree: () => null,
}))

vi.mock('@renderer/features/workspace-files/files-context-menu-portal', () => ({
  FilesContextMenuPortal: () => null,
}))

vi.mock('@renderer/features/workspace-files/file-preview-tab-bar', () => ({
  FilePreviewTabBar: ({ tabs }: { tabs: Array<{ id: string; rel: string; name: string }> }) => (
    <div data-testid="tab-bar">{tabs.map((t) => t.rel).join(',')}</div>
  ),
}))

import { WorkspaceFilesPanel } from '@renderer/features/workspace-files/workspace-files-panel'

describe('WorkspaceFilesPanel open intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: 'D:/proj',
      activePanel: 'review',
      panelOpenIntent: null,
      rightPanelCollapsed: false,
    })
  })

  it('opens the target file when the panel mounts with a pending files intent', async () => {
    // 模拟：点击卡片「打开文件」→ requestPanelOpen
    act(() => {
      useUIStore.getState().requestPanelOpen({
        panel: 'files',
        path: 'src/main.cpp',
        name: 'main.cpp',
      })
    })

    const { rerender } = render(<WorkspaceFilesPanel />)
    // 重渲染一次让 effect 消费意图后的状态刷新
    await act(async () => {
      await Promise.resolve()
      rerender(<WorkspaceFilesPanel />)
    })

    expect(useUIStore.getState().activePanel).toBe('files')
    const tabBar = screen.getByTestId('tab-bar')
    expect(tabBar.textContent).toContain('src/main.cpp')
    expect(screen.getByTestId('preview-router').textContent).toBe('src/main.cpp')
  })

  it('does not re-consume the same intent on remount', async () => {
    act(() => {
      useUIStore.getState().requestPanelOpen({ panel: 'files', path: 'a.ts', name: 'a.ts' })
    })
    const first = render(<WorkspaceFilesPanel />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('tab-bar').textContent).toBe('a.ts')

    // 卸载重挂（模块级 consumed seq 应防止再次消费……但新 intent 无变化，tabs 保持）
    first.unmount()
    const second = render(<WorkspaceFilesPanel />)
    await act(async () => {
      await Promise.resolve()
    })
    // 重新挂载后 resetTabs 会清空 tabs；意图已被消费过，不应再自动打开 a.ts
    expect(second.getByTestId('tab-bar').textContent).toBe('')
  })

  it('subsequent intents open the next file while the panel stays mounted', async () => {
    act(() => {
      useUIStore.getState().requestPanelOpen({ panel: 'files', path: 'a.ts', name: 'a.ts' })
    })
    const view = render(<WorkspaceFilesPanel />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('tab-bar').textContent).toBe('a.ts')

    // 第二次点击：新 seq，应切换到 b.ts
    act(() => {
      useUIStore.getState().requestPanelOpen({ panel: 'files', path: 'src/b.cpp', name: 'b.cpp' })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('tab-bar').textContent).toBe('src/b.cpp')
    expect(screen.getByTestId('preview-router').textContent).toBe('src/b.cpp')

    // 第三次：另一个文件
    act(() => {
      useUIStore.getState().requestPanelOpen({ panel: 'files', path: 'c.md', name: 'c.md' })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('preview-router').textContent).toBe('c.md')
    view.unmount()
  })
})
