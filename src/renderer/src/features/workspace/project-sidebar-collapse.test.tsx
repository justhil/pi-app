import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ProjectSidebar } from './project-sidebar'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({})) },
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/refresh-workspace-session-lists', () => ({
  refreshWorkspaceSessionLists: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(async () => {}),
  switchSessionInPlace: vi.fn(async () => {}),
  previewSessionInPlace: vi.fn(async () => {}),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  useToolCardCatalogReady: () => true,
}))

describe('ProjectSidebar collapse toggle', () => {
  afterEach(() => {
    useUIStore.setState({ sidebarCollapsed: false })
  })

  it.each([false, true])('stays mounted across collapse toggles (starting collapsed=%s)', async (startCollapsed) => {
    useUIStore.setState({ sidebarCollapsed: startCollapsed })
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)

    // The shell keeps the sidebar mounted while collapsed, so the hook order must not depend on it.
    await act(async () => {
      useUIStore.setState({ sidebarCollapsed: !startCollapsed })
    })
    await act(async () => {
      useUIStore.setState({ sidebarCollapsed: startCollapsed })
    })

    expect(container.firstChild).not.toBeNull()
  })
})
