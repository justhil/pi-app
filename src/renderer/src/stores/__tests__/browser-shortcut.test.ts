import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleBrowserPanelFromShortcut } from '@renderer/stores/panel-intent-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { CORE_RIGHT_PANEL_CATALOG } from '@shared/right-panels'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))

describe('toggleBrowserPanelFromShortcut', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    useUIStore.setState({ rightPanelCatalog: CORE_RIGHT_PANEL_CATALOG, activePanel: 'files', browserStageMode: 'closed' })
    useRightDockStore.setState({ openTabIds: ['files'], topActive: 'files', bottomTabIds: [], bottomActive: null, launchpadOpen: false })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    useUIStore.setState({ rightPanelCollapsed: true })
  })

  it('opens and reveals the Browser tab when the right pane is hidden', () => {
    useUIStore.setState({ rightPanelCollapsed: true })

    toggleBrowserPanelFromShortcut()

    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(useRightDockStore.getState().openTabIds).toContain('browser')
    expect(useUIStore.getState().activePanel).toBe('browser')
  })

  it('hides the right pane when the Browser tab is already showing, without entering the removed Stage mode', () => {
    useUIStore.setState({ rightPanelCollapsed: false })
    toggleBrowserPanelFromShortcut()
    expect(useUIStore.getState().activePanel).toBe('browser')

    toggleBrowserPanelFromShortcut()

    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
    expect(useUIStore.getState().browserStageMode).toBe('closed')
  })
})
