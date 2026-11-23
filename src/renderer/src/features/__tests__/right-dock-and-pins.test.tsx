// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeDockSlots, resolveVisibleDockPanels, useRightDockStore } from '@renderer/stores/right-dock-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { isSessionPinned, toggleSessionPinned } from '@renderer/lib/pinned-sessions'
import { buildBrowserToolSummary } from '@renderer/features/timeline/browser-tool-preview'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({})) },
}))

afterEach(() => {
  useRightDockStore.setState({ bottomTabIds: [], topActive: 'files', bottomActive: null, splitRatio: 0.5 })
  useUIStore.setState({ pinnedSessions: [], activePanel: 'files' })
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
