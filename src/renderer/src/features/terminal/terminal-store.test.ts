import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_PANES, MIN_PANE_SHARE, tabTitle, terminalActions, useTerminalStore, type TerminalPaneState } from './terminal-store'

const pane = (id: string, name = 'bash'): TerminalPaneState => ({ ptyId: id, profile: { id: name, name, path: `/bin/${name}`, args: [], kind: name } })
const tab = () => useTerminalStore.getState().tabs[0]

describe('terminal store splits', () => {
  beforeEach(() => useTerminalStore.setState({ open: false, tabs: [], activeTab: null }))

  it('inserts a split right of the focused pane, up to MAX_PANES, with equal widths', () => {
    const id = terminalActions.addTab(pane('a'))
    terminalActions.splitTab(id, pane('b', 'zsh'))
    terminalActions.focusPane(id, 0)
    terminalActions.splitTab(id, pane('c', 'fish'))
    expect(tab().panes.map((p) => p.ptyId)).toEqual(['a', 'c', 'b'])
    expect(tab().activePane).toBe(1)
    expect(tab().sizes).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(tabTitle(tab())).toBe('fish +2')
    terminalActions.splitTab(id, pane('d'))
    expect(terminalActions.splitTab(id, pane('e'))).toBe(false)
    expect(tab().panes).toHaveLength(MAX_PANES)
  })

  it('closing one pane gives its width to the others and focuses the neighbour', () => {
    const id = terminalActions.addTab(pane('a'))
    terminalActions.splitTab(id, pane('b'))
    terminalActions.splitTab(id, pane('c'))
    terminalActions.resizeSplit(id, 0, 0.2)
    terminalActions.focusPane(id, 1)
    terminalActions.closePane('b')
    expect(tab().panes.map((p) => p.ptyId)).toEqual(['a', 'c'])
    expect(tab().sizes.reduce((x, y) => x + y)).toBeCloseTo(1)
    expect(tab().sizes[0]).toBeGreaterThan(tab().sizes[1])
    expect(tab().activePane).toBe(1)
    terminalActions.focusPane(id, 1)
    terminalActions.closePane('a')
    expect(tab().activePane).toBe(0)
    expect(tab().sizes).toEqual([1])
    terminalActions.closePane('c')
    expect(useTerminalStore.getState().tabs).toHaveLength(0)
    expect(useTerminalStore.getState().open).toBe(false)
  })

  it('resize keeps both neighbours above the minimum share', () => {
    const id = terminalActions.addTab(pane('a'))
    terminalActions.splitTab(id, pane('b'))
    terminalActions.resizeSplit(id, 0, 5)
    expect(tab().sizes[1]).toBeCloseTo(MIN_PANE_SHARE)
    terminalActions.resizeSplit(id, 0, -5)
    expect(tab().sizes[0]).toBeCloseTo(MIN_PANE_SHARE)
  })

  it('replacePane swaps an exited pane in place', () => {
    const id = terminalActions.addTab(pane('a'))
    terminalActions.splitTab(id, pane('b'))
    terminalActions.markExited('a', 0)
    terminalActions.replacePane('a', pane('a2'))
    expect(tab().panes.map((p) => [p.ptyId, p.exited])).toEqual([['a2', undefined], ['b', undefined]])
  })
})
