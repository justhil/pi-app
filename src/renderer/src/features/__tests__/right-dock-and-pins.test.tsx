// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeDockSlots, resolveVisibleDockPanels, useRightDockStore } from '@renderer/stores/right-dock-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { RightDock } from '@renderer/features/shell/right-dock'
import { CORE_RIGHT_PANEL_CATALOG } from '@shared/right-panels'
import { isSessionPinned, toggleSessionPinned } from '@renderer/lib/pinned-sessions'
import { buildBrowserToolSummary } from '@renderer/features/timeline/browser-tool-preview'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({})) },
}))

afterEach(() => {
  cleanup()
  useRightDockStore.setState({ openTabIds: [], bottomTabIds: [], topActive: '', bottomActive: null, launchpadOpen: false, splitRatio: 0.5 })
  useUIStore.setState({ pinnedSessions: [], activePanel: 'files', rightPanelCollapsed: true })
})

describe('Decoupled RightDock, Pinned Sessions & Browser Tool Summaries', () => {
  it('defaults to clean single-pane and splits/swaps/merges top and bottom panes mutually exclusively', () => {
    const enabled = ['run', 'files', 'browser', 'worktrees', 'github']
    expect(computeDockSlots(enabled, [])).toEqual({ topIds: enabled, bottomIds: [] })

    useUIStore.setState({ activePanel: 'browser', rightPanelOrder: enabled })
    useRightDockStore.getState().splitToBottom(enabled, 'run')

    const splitState = resolveVisibleDockPanels(enabled, useUIStore.getState().activePanel, useRightDockStore.getState())
    expect(splitState.topActive).toBe('browser')
    expect(splitState.bottomActive).toBe('run')
    expect(splitState.topIds).not.toContain('run')
    expect(splitState.bottomIds).toEqual(['run'])

    // Swap top & bottom panes
    useRightDockStore.getState().swapPanes(enabled)
    const swapped = resolveVisibleDockPanels(enabled, useUIStore.getState().activePanel, useRightDockStore.getState())
    expect(swapped.topActive).toBe('run')
    expect(swapped.bottomActive).toBe('browser')

    // Merge back to clean single pane
    useRightDockStore.getState().mergeToSingle()
    expect(useRightDockStore.getState().bottomTabIds).toEqual([])
  })

  it('opens tabs on demand, closes tabs via middle-click, and auto-collapses when the last tab closes', () => {
    useUIStore.setState({ rightPanelCollapsed: false, activePanel: 'canvas' })
    useRightDockStore.getState().openTab('canvas')
    useRightDockStore.getState().openTab('files')
    expect(useRightDockStore.getState().openTabIds).toEqual(['canvas', 'files'])

    const panels = [
      { key: 'canvas', label: 'Canvas' },
      { key: 'files', label: 'Files' },
      { key: 'browser', label: 'Browser' },
    ]
    render(
      <RightDock
        panels={panels}
        catalog={CORE_RIGHT_PANEL_CATALOG}
        rightPanelHidden={false}
        navSuppressed={false}
      />,
    )

    // Only opened tabs appear in the tab bar — Browser is NOT pre-stuffed in.
    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Browser' })).not.toBeInTheDocument()

    // Middle-click closes Files tab cleanly and falls back to Canvas.
    fireEvent(
      screen.getByRole('tab', { name: 'Files' }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    )
    expect(useRightDockStore.getState().openTabIds).toEqual(['canvas'])
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)

    // Middle-click closes the last panel tab (Canvas): dock stays open on the new-tab launchpad instead of auto-collapsing.
    fireEvent(
      screen.getByRole('tab', { name: 'Canvas' }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    )
    expect(useRightDockStore.getState().openTabIds).toEqual([])
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(screen.getByTestId('right-dock-new-tab-pill')).toBeInTheDocument()

    // Only when the new-tab launchpad itself is closed does the right panel collapse.
    fireEvent(
      screen.getByTestId('right-dock-new-tab-pill'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    )
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('should_keep_right_dock_open_when_closing_panel_leaves_only_new_tab_launchpad', () => {
    useUIStore.setState({ rightPanelCollapsed: false, activePanel: 'canvas' })
    useRightDockStore.getState().openTab('canvas')
    useRightDockStore.getState().setLaunchpadOpen(true)

    const panels = [
      { key: 'canvas', label: 'Canvas' },
      { key: 'files', label: 'Files' },
    ]
    render(
      <RightDock
        panels={panels}
        catalog={CORE_RIGHT_PANEL_CATALOG}
        rightPanelHidden={false}
        navSuppressed={false}
      />,
    )

    fireEvent(
      screen.getByRole('tab', { name: 'Canvas' }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    )
    expect(useRightDockStore.getState().openTabIds).toEqual([])
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(screen.getByTestId('right-dock-new-tab-pill')).toBeInTheDocument()

    const closeNewTabBtn = screen.getByTestId('right-dock-new-tab-pill').querySelector('button[aria-label]')!
    fireEvent.click(closeNewTabBtn)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('shows Codex-style new-tab launchpad when opened with no active tabs and launches panels on click', () => {
    useUIStore.setState({ rightPanelCollapsed: false, activePanel: 'files' })
    useRightDockStore.setState({ openTabIds: [], bottomTabIds: [], topActive: '', bottomActive: null })

    const panels = [
      { key: 'canvas', label: 'Canvas' },
      { key: 'files', label: 'Files' },
      { key: 'browser', label: 'Browser' },
      { key: 'review', label: 'Review' },
    ]
    render(
      <RightDock
        panels={panels}
        catalog={CORE_RIGHT_PANEL_CATALOG}
        rightPanelHidden={false}
        navSuppressed={false}
      />,
    )

    expect(screen.getByTestId('right-dock-new-tab-pill')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search files, panels, or enter URL')).toBeInTheDocument()

    // Clicking a launchpad card opens that panel as a tab immediately.
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }))
    expect(useRightDockStore.getState().openTabIds).toEqual(['canvas'])
    expect(screen.getByRole('tab', { name: 'Canvas' })).toBeInTheDocument()

    // Opening the new-tab launchpad while Canvas is open, then toggling Canvas from the rail, returns to Canvas instead of collapsing.
    fireEvent.click(screen.getByTestId('right-dock-open-tab-btn'))
    expect(useRightDockStore.getState().launchpadOpen).toBe(true)
    usePanelIntentStore.getState().toggleRightPanelTab('canvas', true)
    expect(useRightDockStore.getState().launchpadOpen).toBe(false)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('pins and unpins sessions case/slash-insensitively', () => {
    expect(toggleSessionPinned('D:\\repo\\sess-1.jsonl')).toBe(true)
    expect(isSessionPinned(useUIStore.getState().pinnedSessions, 'd:/repo/sess-1.jsonl')).toBe(true)
    expect(toggleSessionPinned('d:/repo/sess-1.jsonl')).toBe(false)
    expect(isSessionPinned(useUIStore.getState().pinnedSessions, 'D:\\repo\\sess-1.jsonl')).toBe(false)
  })

  it('formats crisp natural-language summaries for browser_* tools', () => {
    expect(buildBrowserToolSummary('browser_navigate', { url: 'http://localhost:5173' })).toBe('http://localhost:5173')
    expect(buildBrowserToolSummary('browser_click', { target: 'e14', doubleClick: true })).toBe('double-click e14')
    expect(buildBrowserToolSummary('browser_type', { target: 'e5', text: 'hello world' })).toBe('"hello world" → e5')
    expect(buildBrowserToolSummary('browser_batch', { steps: [{}, {}, {}] })).toBe('3 step(s)')
  })
})
