import { create } from 'zustand'
import { useUIStore } from './ui-store'
import { isPanelVisibleInRightDock, useRightDockStore } from './right-dock-store'

interface PanelIntentState {
  focusedPrNumber: number | null
  openWorktreeCreateSignal: number
  openGitHubPr: (prNumber: number | null) => void
  toggleRightPanelTab: (panelId: 'canvas' | 'worktrees' | 'github' | 'browser' | string, isRightPanelOpen: boolean) => void
  openWorktreesPanel: (opts?: { expandCreate?: boolean }) => void
  consumeFocusedPr: () => void
}

export const usePanelIntentStore = create<PanelIntentState>((set) => ({
  focusedPrNumber: null,
  openWorktreeCreateSignal: 0,
  openGitHubPr: (prNumber) => {
    set({ focusedPrNumber: prNumber })
    useRightDockStore.getState().activatePanelSmart('github')
    useUIStore.getState().revealRightPanel()
  },
  toggleRightPanelTab: (panelId, isRightPanelOpen) => {
    const ui = useUIStore.getState()
    const dock = useRightDockStore.getState()
    const alreadyShowing = isRightPanelOpen && isPanelVisibleInRightDock(panelId)
    if (alreadyShowing && dock.bottomTabIds.length === 0) {
      ui.toggleRightPanel()
      return
    }
    if (panelId === 'github') set({ focusedPrNumber: null })
    dock.activatePanelSmart(panelId)
    ui.revealRightPanel()
  },
  openWorktreesPanel: (opts) => {
    if (opts?.expandCreate) {
      set((s) => ({ openWorktreeCreateSignal: s.openWorktreeCreateSignal + 1 }))
    }
    useRightDockStore.getState().activatePanelSmart('worktrees')
    useUIStore.getState().revealRightPanel()
  },
  consumeFocusedPr: () => set({ focusedPrNumber: null }),
}))
