import { create } from 'zustand'

export type ShellProfile = { id: string; name: string; path: string; args: string[]; kind: string; piDefault?: boolean }
/** One pty, shown in a pane. `exited` keeps the pane (with its output) until the user closes it. */
export type TerminalPaneState = { ptyId: string; profile: ShellProfile; exited?: number }
export type TerminalTab = { id: string; panes: TerminalPaneState[]; activePane: number; title: string }

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
    set((s) => ({ tabs: [...s.tabs, { id, panes: [pane], activePane: 0, title: pane.profile.name }], activeTab: id, open: true }))
    return id
  },
  /** Second pane beside the active one (one split per tab). */
  splitTab(tabId: string, pane: TerminalPaneState) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId && t.panes.length < 2 ? { ...t, panes: [...t.panes, pane], activePane: t.panes.length } : t)) }))
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
  /** Remove a pane; a tab with no panes left goes too. Returns the pty ids that were removed. */
  closePane(ptyId: string): void {
    set((s) => {
      const tabs = s.tabs
        .map((t) => {
          const panes = t.panes.filter((p) => p.ptyId !== ptyId)
          return { ...t, panes, activePane: Math.min(t.activePane, Math.max(0, panes.length - 1)) }
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
