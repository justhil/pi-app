import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesPanel } from './workspace-files-panel'
import { useUIStore } from '@renderer/stores/ui-store'
vi.mock('./file-tree', () => ({ FileTree: () => null }))
vi.mock('./file-preview-router', () => ({ FilePreviewRouter: () => <div>preview</div> }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({ ok: true, entries: [] }) } }))
afterEach(cleanup)
function openPreview() {
  useUIStore.setState({ currentWorkspace: '/fixture', activePanel: 'files', filesPreviewChatExpand: false })
  render(<WorkspaceFilesPanel />)
  act(() => window.dispatchEvent(new CustomEvent('pi-desktop:open-workspace-file', { detail: { rel: '中文.html' } })))
  fireEvent.click(screen.getByTitle(/Expand preview|展开预览/))
  expect(useUIStore.getState().filesPreviewChatExpand).toBe(true)
}
it('restores chat after closing the last expanded preview tab', () => {
  openPreview()
  fireEvent.mouseDown(screen.getByText('中文.html'), { button: 1 })
  expect(useUIStore.getState().filesPreviewChatExpand).toBe(false)
})
it('Escape exits expansion and keeps the file open', () => {
  openPreview()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useUIStore.getState().filesPreviewChatExpand).toBe(false)
  expect(screen.getByText('中文.html')).toBeInTheDocument()
})
