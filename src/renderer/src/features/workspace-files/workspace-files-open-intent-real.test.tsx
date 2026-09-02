import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { useUIStore } from '@renderer/stores/ui-store'

const readText = vi.fn(async () => ({ ok: true, content: 'file content', size: 12 }))
const listDir = vi.fn(async () => ({ ok: true, entries: [] }))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async (_m: string, p: Record<string, unknown>) => {
    if (_m === 'workspace.fs.readText') return readText()
    if (_m === 'workspace.fs.listDir') return listDir()
    return { ok: true }
  }) },
}))

vi.mock('@renderer/features/workspace-files/file-tree', () => ({
  FileTree: () => null,
}))

vi.mock('@renderer/features/workspace-files/files-context-menu-portal', () => ({
  FilesContextMenuPortal: () => null,
}))

import { WorkspaceFilesPanel } from '@renderer/features/workspace-files/workspace-files-panel'

describe('WorkspaceFilesPanel with real preview router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: 'D:/proj',
      activePanel: 'review',
      panelOpenIntent: null,
      rightPanelCollapsed: false,
    })
  })

  it('mount-consumed intent opens the file and the real preview router shows content', async () => {
    act(() => {
      useUIStore.getState().requestPanelOpen({
        panel: 'files',
        path: 'src/main.cpp',
        name: 'main.cpp',
      })
    })

    render(<WorkspaceFilesPanel />)
    // 等待意图消费 + readText 异步完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(useUIStore.getState().activePanel).toBe('files')
    expect(screen.getByText('main.cpp')).toBeTruthy() // tab
    expect(screen.getByText('file content')).toBeTruthy() // 预览内容
  })

  it('survives React.StrictMode double effects: the opened file is not cleared', async () => {
    act(() => {
      useUIStore.getState().requestPanelOpen({
        panel: 'files',
        path: 'src/main.cpp',
        name: 'main.cpp',
      })
    })

    render(
      <StrictMode>
        <WorkspaceFilesPanel />
      </StrictMode>,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // StrictMode 双跑 effect 时，resetTabs 不应清掉意图打开的文件
    expect(screen.getByText('main.cpp')).toBeTruthy()
    expect(screen.getByText('file content')).toBeTruthy()
  })

  it('subsequent live-event open switches the preview', async () => {
    act(() => {
      useUIStore.getState().requestPanelOpen({ panel: 'files', path: 'a.ts', name: 'a.ts' })
    })
    render(<WorkspaceFilesPanel />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByText('file content')).toBeTruthy()

    readText.mockResolvedValue({ ok: true, content: 'second file', size: 11 })
    act(() => {
      window.dispatchEvent(
        new CustomEvent('pi-desktop:open-workspace-file', {
          detail: { rel: 'src/b.md', name: 'b.md' },
        }),
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByText('second file')).toBeTruthy()
  })
})
