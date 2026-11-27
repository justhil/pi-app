import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveVisibleDockPanels, useRightDockStore } from '@renderer/stores/right-dock-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { CORE_RIGHT_PANEL_CATALOG } from '@shared/right-panels'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))

afterEach(() => {
  useRightDockStore.setState({ openTabIds: [], bottomTabIds: [], topActive: '', bottomActive: null, launchpadOpen: false })
})

describe('openTab into the bottom pane', () => {
  it('does not record a bottom tab that would leave the top pane empty', () => {
    useUIStore.setState({ rightPanelCatalog: CORE_RIGHT_PANEL_CATALOG, activePanel: 'files' })
    useRightDockStore.setState({ openTabIds: ['files', 'review'], bottomTabIds: ['review'], topActive: 'files', bottomActive: 'review' })

    // 'files' is the only top tab, so it cannot move down.
    const slot = useRightDockStore.getState().openTab('files', { slot: 'bottom' })

    const dock = useRightDockStore.getState()
    expect(slot).toBe('top')
    expect(dock.bottomTabIds).toEqual(['review'])
    expect(dock.bottomActive).toBe('review')
    const visible = resolveVisibleDockPanels(dock.openTabIds, useUIStore.getState().activePanel, dock)
    expect(visible).toMatchObject({ topIds: ['files'], bottomIds: ['review'], topActive: 'files', bottomActive: 'review' })
  })

  it('still opens a new tab in the bottom pane', () => {
    useUIStore.setState({ rightPanelCatalog: CORE_RIGHT_PANEL_CATALOG, activePanel: 'files' })
    useRightDockStore.setState({ openTabIds: ['files'], bottomTabIds: [], topActive: 'files', bottomActive: null })

    const slot = useRightDockStore.getState().openTab('review', { slot: 'bottom' })

    expect(slot).toBe('bottom')
    expect(useRightDockStore.getState()).toMatchObject({ bottomTabIds: ['review'], bottomActive: 'review', topActive: 'files' })
  })
})
