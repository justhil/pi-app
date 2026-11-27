// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showRightPanelTab, useRightDockStore } from '@renderer/stores/right-dock-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { RightDock } from '@renderer/features/shell/right-dock'
import { CORE_RIGHT_PANEL_CATALOG } from '@shared/right-panels'
import { openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))

const panels = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'files', label: 'Files' },
]

/** Mirrors MainLayoutShell: the dock is only mounted while the right pane is shown. */
function DockWhenShown() {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  return collapsed ? null : (
    <RightDock panels={panels} catalog={CORE_RIGHT_PANEL_CATALOG} rightPanelHidden={false} navSuppressed={false} />
  )
}

function dockState() {
  const d = useRightDockStore.getState()
  return { openTabIds: d.openTabIds, launchpadOpen: d.launchpadOpen, activePanel: useUIStore.getState().activePanel }
}

describe('showRightPanelTab', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    useUIStore.setState({
      rightPanelCatalog: CORE_RIGHT_PANEL_CATALOG,
      rightPanelOrder: ['canvas', 'files'],
      currentWorkspace: '/w',
      workspaceFileToOpen: null,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    useRightDockStore.setState({ openTabIds: [], bottomTabIds: [], topActive: '', bottomActive: null, launchpadOpen: false })
    useUIStore.setState({ activePanel: 'files', rightPanelCollapsed: true })
  })

  it('opens the Files tab when a file link is followed while the right pane is collapsed', async () => {
    useUIStore.setState({ rightPanelCollapsed: true, activePanel: 'canvas' })
    useRightDockStore.setState({ openTabIds: ['canvas'], topActive: 'canvas' })
    render(<DockWhenShown />)

    await act(async () => {
      openWorkspaceRelativePath('src/a.ts')
    })

    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(dockState()).toEqual({ openTabIds: ['canvas', 'files'], launchpadOpen: false, activePanel: 'files' })
    expect(useRightDockStore.getState().topActive).toBe('files')
  })

  it('reopens the panel after its tab was closed even though activePanel still names it', async () => {
    useUIStore.setState({ rightPanelCollapsed: false, activePanel: 'files' })
    useRightDockStore.setState({ openTabIds: ['files'], topActive: 'files' })
    render(<DockWhenShown />)

    await act(async () => {
      useRightDockStore.getState().closeTab('files')
    })
    expect(dockState()).toMatchObject({ openTabIds: [], launchpadOpen: true })

    await act(async () => {
      openWorkspaceRelativePath('src/a.ts')
    })

    expect(dockState()).toEqual({ openTabIds: ['files'], launchpadOpen: false, activePanel: 'files' })
  })

  it('leaves unknown panel ids to setActivePanel instead of adding a dead tab', () => {
    useUIStore.setState({ rightPanelCollapsed: true, activePanel: 'files' })
    useRightDockStore.setState({ openTabIds: ['files'], topActive: 'files' })

    showRightPanelTab('adapter:not-loaded')

    expect(useRightDockStore.getState().openTabIds).toEqual(['files'])
    expect(useUIStore.getState().activePanel).not.toBe('adapter:not-loaded')
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
  })
})
