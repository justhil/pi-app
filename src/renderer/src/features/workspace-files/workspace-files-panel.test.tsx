import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesPanel } from './workspace-files-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import { useEditorStore } from '@renderer/stores/editor-store'

vi.mock('./file-tree', () => ({
  FileTree: ({ onSelectPath }: { onSelectPath: (rel: string, isDirectory: boolean) => void }) => (
    <button type="button" onClick={() => onSelectPath('src/app.ts', false)}>
      tree-row
    </button>
  ),
}))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({ ok: true, entries: [] }) } }))

beforeEach(() => {
  useEditorStore.getState().reset()
  useUIStore.setState({ currentWorkspace: '/fixture', activePanel: 'files' })
})
afterEach(cleanup)

it('shows hidden files by default and hides them on demand', () => {
  render(<WorkspaceFilesPanel />)
  const eye = screen.getByRole('button', { name: /Hide hidden files|隐藏隐藏文件/ })
  expect(eye).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(eye)
  expect(screen.getByRole('button', { name: /Show hidden files|显示隐藏文件/ })).toHaveAttribute('aria-pressed', 'false')
})

it('opens a clicked file in the main-column editor instead of a side preview', () => {
  render(<WorkspaceFilesPanel />)
  fireEvent.click(screen.getByText('tree-row'))
  const state = useEditorStore.getState()
  expect(state.docs.map((d) => d.rel)).toEqual(['src/app.ts'])
  expect(state.activeId).toBe(state.docs[0].id)
})
