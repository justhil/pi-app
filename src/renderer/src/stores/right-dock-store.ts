import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useUIStore } from './ui-store'

export type DockSlot = 'top' | 'bottom'

export interface RightDockState {
  bottomTabIds: string[]
  topActive: string
  bottomActive: string | null
  splitRatio: number
  workspaceMemory: Record<string, { topActive: string; bottomActive: string | null }>

  setSplitRatio: (ratio: number) => void
  resetSplitRatio: () => void
  activateInSlot: (slot: DockSlot, panelId: string, enabledIds: readonly string[]) => void
  activatePanelSmart: (panelId: string, enabledIds?: readonly string[]) => DockSlot
  movePanel: (
    panelId: string,
    targetSlot: DockSlot,
    enabledIds: readonly string[],
    targetIndex?: number,
  ) => void
  splitToBottom: (enabledIds: readonly string[], preferredBottomId?: string) => void
  mergeToSingle: () => void
  swapPanes: (enabledIds: readonly string[]) => void
  reconcile: (enabledIds: readonly string[], fallbackTop: string) => void
  rememberWorkspace: (workspaceKey: string | null, topActive: string, bottomActive: string | null) => void
  restoreWorkspace: (workspaceKey: string | null, enabledIds: readonly string[]) => void
}

export function computeDockSlots(
  enabledIds: readonly string[],
  bottomTabIds: readonly string[],
): { topIds: string[]; bottomIds: string[] } {
  if (enabledIds.length <= 1) {
    return { topIds: [...enabledIds], bottomIds: [] }
  }
  const enabledSet = new Set(enabledIds)
  const validBottom = bottomTabIds.filter((id) => enabledSet.has(id))
  if (validBottom.length >= enabledIds.length) {
    const keepTop = enabledIds[0]
    return {
      topIds: [keepTop],
      bottomIds: validBottom.filter((id) => id !== keepTop),
    }
  }
  const bottomSet = new Set(validBottom)
  const topIds = enabledIds.filter((id) => !bottomSet.has(id))
  return { topIds, bottomIds: validBottom }
}

export function resolveVisibleDockPanels(
  enabledIds: readonly string[],
  activePanel: string,
  dock: Pick<RightDockState, 'bottomTabIds' | 'topActive' | 'bottomActive'>,
): { topIds: string[]; bottomIds: string[]; topActive: string; bottomActive: string | null } {
  const { topIds, bottomIds } = computeDockSlots(enabledIds, dock.bottomTabIds)
  const topActive = topIds.includes(activePanel)
    ? activePanel
    : topIds.includes(dock.topActive)
      ? dock.topActive
      : (topIds[0] ?? activePanel)
  const bottomActive =
    bottomIds.length > 0
      ? dock.bottomActive && bottomIds.includes(dock.bottomActive)
        ? dock.bottomActive
        : bottomIds[0]
      : null
  return { topIds, bottomIds, topActive, bottomActive }
}

export function getEnabledRightPanelIdsFromStore(): string[] {
  const ui = useUIStore.getState()
  const baseOrder = ui.rightPanelOrder.length
    ? ui.rightPanelOrder
    : ui.rightPanelCatalog.map((c) => c.id)
  return baseOrder.filter((id) => ui.rightPanelPrefs[id])
}

export function isPanelVisibleInRightDock(panelId: string): boolean {
  const ui = useUIStore.getState()
  const dock = useRightDockStore.getState()
  const enabledIds = getEnabledRightPanelIdsFromStore()
  const { topActive, bottomActive } = resolveVisibleDockPanels(enabledIds, ui.activePanel, dock)
  return topActive === panelId || bottomActive === panelId
}

export const useRightDockStore = create<RightDockState>()(
  persist(
    (set, get) => ({
      bottomTabIds: [],
      topActive: 'files',
      bottomActive: null,
      splitRatio: 0.5,
      workspaceMemory: {},

      setSplitRatio: (ratio) =>
        set({ splitRatio: Math.max(0.22, Math.min(0.78, ratio)) }),

      resetSplitRatio: () => set({ splitRatio: 0.5 }),

      activateInSlot: (slot, panelId, enabledIds) => {
        const { topIds, bottomIds } = computeDockSlots(enabledIds, get().bottomTabIds)
        if (slot === 'top' && topIds.includes(panelId)) {
          set({ topActive: panelId })
          useUIStore.getState().setActivePanel(panelId)
        } else if (slot === 'bottom' && bottomIds.includes(panelId)) {
          set({ bottomActive: panelId })
        }
      },

      activatePanelSmart: (panelId, providedEnabled) => {
        const ui = useUIStore.getState()
        if (!ui.rightPanelPrefs[panelId]) {
          useUIStore.setState((s) => ({
            rightPanelPrefs: { ...s.rightPanelPrefs, [panelId]: true },
          }))
        }
        const enabledIds = providedEnabled ?? getEnabledRightPanelIdsFromStore()
        const withTarget = enabledIds.includes(panelId) ? enabledIds : [...enabledIds, panelId]
        const { bottomIds } = computeDockSlots(withTarget, get().bottomTabIds)
        if (bottomIds.includes(panelId)) {
          set({ bottomActive: panelId })
          return 'bottom'
        }
        set({ topActive: panelId })
        ui.setActivePanel(panelId)
        return 'top'
      },

      movePanel: (panelId, targetSlot, enabledIds, targetIndex) => {
        if (enabledIds.length <= 1) return
        const cur = get()
        const { topIds, bottomIds } = computeDockSlots(enabledIds, cur.bottomTabIds)

        if (targetSlot === 'bottom') {
          if (topIds.length <= 1 && topIds[0] === panelId) return
          const nextBottom = bottomIds.filter((id) => id !== panelId)
          const insertAt =
            targetIndex === undefined
              ? nextBottom.length
              : Math.max(0, Math.min(nextBottom.length, targetIndex))
          nextBottom.splice(insertAt, 0, panelId)
          const nextTop = enabledIds.filter((id) => !nextBottom.includes(id))
          const uiActive = useUIStore.getState().activePanel
          const nextTopActive =
            uiActive !== panelId && nextTop.includes(uiActive)
              ? uiActive
              : cur.topActive !== panelId && nextTop.includes(cur.topActive)
                ? cur.topActive
                : (nextTop[0] ?? panelId)
          set({
            bottomTabIds: nextBottom,
            topActive: nextTopActive,
            bottomActive: panelId,
          })
          useUIStore.getState().setActivePanel(nextTopActive)
          return
        }

        const nextBottom = bottomIds.filter((id) => id !== panelId)
        const nextTop = topIds.filter((id) => id !== panelId)
        const insertAt =
          targetIndex === undefined
            ? nextTop.length
            : Math.max(0, Math.min(nextTop.length, targetIndex))
        nextTop.splice(insertAt, 0, panelId)

        const fullOrder = [
          ...nextTop,
          ...nextBottom,
          ...useUIStore.getState().rightPanelOrder.filter((id) => !nextTop.includes(id) && !nextBottom.includes(id)),
        ]
        useUIStore.setState({ rightPanelOrder: fullOrder })

        const nextBottomActive =
          nextBottom.length === 0
            ? null
            : cur.bottomActive && nextBottom.includes(cur.bottomActive)
              ? cur.bottomActive
              : nextBottom[0]
        set({
          bottomTabIds: nextBottom,
          topActive: panelId,
          bottomActive: nextBottomActive,
        })
        useUIStore.getState().setActivePanel(panelId)
      },

      splitToBottom: (enabledIds, preferredBottomId) => {
        if (enabledIds.length <= 1) return
        const uiActive = useUIStore.getState().activePanel
        const currentTop = enabledIds.includes(uiActive) ? uiActive : enabledIds[0]
        const candidate =
          preferredBottomId && enabledIds.includes(preferredBottomId) && preferredBottomId !== currentTop
            ? preferredBottomId
            : (enabledIds.find((id) => id !== currentTop) ?? enabledIds[enabledIds.length - 1])
        if (!candidate || candidate === currentTop) return
        set({
          bottomTabIds: [candidate],
          topActive: currentTop,
          bottomActive: candidate,
        })
      },

      mergeToSingle: () => set({ bottomTabIds: [], bottomActive: null }),

      swapPanes: (enabledIds) => {
        const cur = get()
        const { topIds, bottomIds } = computeDockSlots(enabledIds, cur.bottomTabIds)
        if (bottomIds.length === 0 || topIds.length === 0) return
        const uiActive = useUIStore.getState().activePanel
        const prevTopActive = topIds.includes(uiActive) ? uiActive : topIds[0]
        const prevBottomActive =
          cur.bottomActive && bottomIds.includes(cur.bottomActive) ? cur.bottomActive : bottomIds[0]
        const fullOrder = [
          ...bottomIds,
          ...topIds,
          ...useUIStore.getState().rightPanelOrder.filter((id) => !topIds.includes(id) && !bottomIds.includes(id)),
        ]
        useUIStore.setState({ rightPanelOrder: fullOrder, activePanel: prevBottomActive })
        set({
          bottomTabIds: topIds,
          topActive: prevBottomActive,
          bottomActive: prevTopActive,
          splitRatio: Number((1 - cur.splitRatio).toFixed(3)),
        })
      },

      reconcile: (enabledIds, fallbackTop) => {
        const cur = get()
        const { topIds, bottomIds } = computeDockSlots(enabledIds, cur.bottomTabIds)
        const nextTop = topIds.includes(fallbackTop)
          ? fallbackTop
          : topIds.includes(cur.topActive)
            ? cur.topActive
            : (topIds[0] ?? fallbackTop)
        const nextBottom =
          bottomIds.length === 0
            ? null
            : cur.bottomActive && bottomIds.includes(cur.bottomActive)
              ? cur.bottomActive
              : bottomIds[0]
        if (
          bottomIds.join(',') !== cur.bottomTabIds.join(',') ||
          nextTop !== cur.topActive ||
          nextBottom !== cur.bottomActive
        ) {
          set({
            bottomTabIds: bottomIds,
            topActive: nextTop,
            bottomActive: nextBottom,
          })
        }
      },

      rememberWorkspace: (workspaceKey, topActive, bottomActive) => {
        if (!workspaceKey) return
        set((s) => ({
          workspaceMemory: {
            ...s.workspaceMemory,
            [workspaceKey]: { topActive, bottomActive },
          },
        }))
      },

      restoreWorkspace: (workspaceKey, enabledIds) => {
        if (!workspaceKey) return
        const cur = get()
        const remembered = cur.workspaceMemory[workspaceKey]
        if (!remembered) return
        const { topIds, bottomIds } = computeDockSlots(enabledIds, cur.bottomTabIds)
        const nextTop = topIds.includes(remembered.topActive) ? remembered.topActive : cur.topActive
        const nextBottom =
          bottomIds.length > 0 && remembered.bottomActive && bottomIds.includes(remembered.bottomActive)
            ? remembered.bottomActive
            : cur.bottomActive
        if (nextTop !== cur.topActive || nextBottom !== cur.bottomActive) {
          set({ topActive: nextTop, bottomActive: nextBottom })
          if (topIds.includes(nextTop)) useUIStore.getState().setActivePanel(nextTop)
        }
      },
    }),
    {
      name: 'pi-right-dock-v1',
      partialize: (s) => ({
        bottomTabIds: s.bottomTabIds,
        topActive: s.topActive,
        bottomActive: s.bottomActive,
        splitRatio: s.splitRatio,
        workspaceMemory: s.workspaceMemory,
      }),
    },
  ),
)
