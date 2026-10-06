import { create } from 'zustand'

export type ShellProfile = { id: string; name: string; path: string; args: string[]; kind: string; piDefault?: boolean }
/** One pty, shown in a pane. `exited` keeps the pane (with its output) until the user closes it. */
export type TerminalPaneState = { ptyId: string; profile: ShellProfile; exited?: number }
/** `sizes`: each pane's share of the tab width (sums to 1). */
export type TerminalTab = { id: string; panes: TerminalPaneState[]; activePane: number; sizes: number[] }

export const MAX_PANES = 4
/** Narrowest a pane can be dragged, as a share of the tab width. */
export const MIN_PANE_SHARE = 0.12

const equal = (n: number) => Array.from({ length: n }, () => 1 / n)

/** Tab label: the focused pane's shell, `+N` for the others. */
export function tabTitle(tab: TerminalTab): string {
  const name = tab.panes[tab.activePane]?.profile.name ?? tab.panes[0]?.profile.name ?? ''
  return tab.panes.length > 1 ? `${name} +${tab.panes.length - 1}` : name
}

const HEIGHT_KEY = 'pi-desktop:terminal-height:v1'
export const MIN_TERMINAL_H = 120

function readHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(n) && n >= MIN_TERMINAL_H ? n : 280
  } catch {
    return 280
  }
}

type State = {
  open: boolean
  height: number
  tabs: TerminalTab[]
  activeTab: string | null
  profiles: ShellProfile[] | null
}

export const useTerminalStore = create<State>(() => ({ open: false, height: readHeight(), tabs: [], activeTab: null, profiles: null }))

let tabSeq = 0
const set = useTerminalStore.setState
const get = useTerminalStore.getState

export const terminalActions = {
  setOpen(open: boolean) {
    set({ open })
  },
  toggle() {
    set({ open: !get().open })
  },
  setHeight(h: number) {
    const height = Math.max(MIN_TERMINAL_H, Math.round(h))
    set({ height })
    try {
      localStorage.setItem(HEIGHT_KEY, String(height))
    } catch {
      /* per-viewer convenience only */
    }
  },
  setProfiles(profiles: ShellProfile[]) {
    set({ profiles })
  },
  addTab(pane: TerminalPaneState): string {
    const id = `tab${++tabSeq}`
    set((s) => ({ tabs: [...s.tabs, { id, panes: [pane], activePane: 0, sizes: [1] }], activeTab: id, open: true }))
    return id
  },
  /** A new pane right of the focused one (up to MAX_PANES); widths reset to equal. Returns false when full. */
  splitTab(tabId: string, pane: TerminalPaneState): boolean {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || tab.panes.length >= MAX_PANES) return false
    const at = tab.activePane + 1
    const panes = [...tab.panes.slice(0, at), pane, ...tab.panes.slice(at)]
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, panes, activePane: at, sizes: equal(panes.length) } : t)) }))
    return true
  },
  /** Drag the border right of pane `index` by `delta` (share of the tab width). */
  resizeSplit(tabId: string, index: number, delta: number) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || index < 0 || index >= t.panes.length - 1) return t
        const pair = t.sizes[index] + t.sizes[index + 1]
        const left = Math.min(pair - MIN_PANE_SHARE, Math.max(MIN_PANE_SHARE, t.sizes[index] + delta))
        const sizes = [...t.sizes]
        sizes[index] = left
        sizes[index + 1] = pair - left
        return { ...t, sizes }
      }),
    }))
  },
  /** An exited pane gets a fresh pty in the same slot. */
  replacePane(oldPtyId: string, pane: TerminalPaneState) {
    set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => (p.ptyId === oldPtyId ? pane : p)) })) }))
  },
  focusTab(tabId: string) {
    set({ activeTab: tabId })
  },
  focusPane(tabId: string, index: number) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activePane: index } : t)) }))
  },
  markExited(ptyId: string, code: number) {
    set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => (p.ptyId === ptyId ? { ...p, exited: code } : p)) })) }))
  },
  /**
   * Remove a pane: its width goes to the neighbours (proportionally) and focus to the pane that took
   * its place; a tab with no panes left goes too.
   */
  closePane(ptyId: string): void {
    set((s) => {
      const tabs = s.tabs
        .map((t) => {
          const i = t.panes.findIndex((p) => p.ptyId === ptyId)
          if (i < 0) return t
          const panes = t.panes.filter((_, j) => j !== i)
          const rest = t.sizes.filter((_, j) => j !== i)
          const sum = rest.reduce((a, b) => a + b, 0)
          const sizes = sum > 0 ? rest.map((x) => x / sum) : equal(panes.length)
          const activePane = t.activePane > i ? t.activePane - 1 : Math.min(t.activePane, Math.max(0, panes.length - 1))
          return { ...t, panes, sizes, activePane }
        })
        .filter((t) => t.panes.length > 0)
      const activeTab = tabs.some((t) => t.id === s.activeTab) ? s.activeTab : (tabs[tabs.length - 1]?.id ?? null)
      return { tabs, activeTab, open: tabs.length ? s.open : false }
    })
  },
  closeTab(tabId: string): string[] {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return []
    for (const p of tab.panes) terminalActions.closePane(p.ptyId)
    return tab.panes.map((p) => p.ptyId)
  },
}
