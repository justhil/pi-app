import { create } from 'zustand'
import { useUIStore } from './ui-store'

interface PanelIntentState {
  focusedPrNumber: number | null
  openWorktreeCreateSignal: number
  openGitHubPr: (prNumber: number | null) => void
  toggleRightPanelTab: (panelId: 'worktrees' | 'github', isCurrentlyVisible: boolean) => void
  openWorktreesPanel: (opts?: { expandCreate?: boolean }) => void
  consumeFocusedPr: () => void
}

export const usePanelIntentStore = create<PanelIntentState>((set) => ({
  focusedPrNumber: null,
  openWorktreeCreateSignal: 0,
  openGitHubPr: (prNumber) => {
    set({ focusedPrNumber: prNumber })
    const ui = useUIStore.getState()
    ui.setActivePanel('github')
    ui.revealRightPanel()
  },
  toggleRightPanelTab: (panelId, isCurrentlyVisible) => {
    const ui = useUIStore.getState()
    if (isCurrentlyVisible && ui.activePanel === panelId && ui.browserStageMode === 'closed') {
      ui.toggleRightPanel()
      return
    }
    if (panelId === 'github') set({ focusedPrNumber: null })
    ui.setActivePanel(panelId)
    ui.revealRightPanel()
  },
  openWorktreesPanel: (opts) => {
    if (opts?.expandCreate) {
      set((s) => ({ openWorktreeCreateSignal: s.openWorktreeCreateSignal + 1 }))
    }
    const ui = useUIStore.getState()
    ui.setActivePanel('worktrees')
    ui.revealRightPanel()
  },
  consumeFocusedPr: () => set({ focusedPrNumber: null }),
}))
