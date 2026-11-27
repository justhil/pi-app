import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useUIStore } from './ui-store'

export type DockSlot = 'top' | 'bottom'

export interface RightDockState {
  openTabIds: string[]
  bottomTabIds: string[]
  topActive: string
  bottomActive: string | null
  launchpadOpen: boolean
  splitRatio: number
  workspaceMemory: Record<string, { topActive: string; bottomActive: string | null }>

  setLaunchpadOpen: (open: boolean) => void
  setSplitRatio: (ratio: number) => void
  resetSplitRatio: () => void
  activateInSlot: (slot: DockSlot, panelId: string, openIds: readonly string[]) => void
  activatePanelSmart: (panelId: string, availableIds?: readonly string[]) => DockSlot
  openTab: (panelId: string, opts?: { slot?: DockSlot; focus?: boolean }) => DockSlot
  closeTab: (panelId: string) => void
  closeOtherTabs: (keepPanelId: string) => void
  closeAllTabs: () => void
  movePanel: (
    panelId: string,
    targetSlot: DockSlot,
    openIds: readonly string[],
    targetIndex?: number,
  ) => void
  splitToBottom: (openIds: readonly string[], preferredBottomId?: string) => void
  mergeToSingle: () => void
  swapPanes: (openIds: readonly string[]) => void
  reconcile: (availableIds: readonly string[], fallbackTop: string) => void
  rememberWorkspace: (workspaceKey: string | null, topActive: string, bottomActive: string | null) => void
  restoreWorkspace: (workspaceKey: string | null, availableIds: readonly string[]) => void
}

export function computeDockSlots(
  openIds: readonly string[],
  bottomTabIds: readonly string[],
): { topIds: string[]; bottomIds: string[] } {
  if (openIds.length <= 1) {
    return { topIds: [...openIds], bottomIds: [] }
  }
  const openSet = new Set(openIds)
  const validBottom = bottomTabIds.filter((id) => openSet.has(id))
  if (validBottom.length >= openIds.length) {
    const keepTop = openIds[0]
    return {
      topIds: [keepTop],
      bottomIds: validBottom.filter((id) => id !== keepTop),
    }
  }
  const bottomSet = new Set(validBottom)
  const topIds = openIds.filter((id) => !bottomSet.has(id))
  return { topIds, bottomIds: validBottom }
}

export function resolveOpenTabIds(
  availableIds: readonly string[],
  openTabIds: readonly string[],
  fallbackPanel?: string | null,
  allowFallbackWhenEmpty = false,
): string[] {
  const availableSet = new Set(availableIds)
  const out: string[] = []
  for (const id of openTabIds) {
    if (availableSet.has(id) && !out.includes(id)) out.push(id)
  }
  if (out.length === 0 && allowFallbackWhenEmpty && fallbackPanel && availableSet.has(fallbackPanel)) {
    return [fallbackPanel]
  }
  return out
}

export function resolveVisibleDockPanels(
  openIds: readonly string[],
  activePanel: string,
  dock: Pick<RightDockState, 'bottomTabIds' | 'topActive' | 'bottomActive'>,
): { topIds: string[]; bottomIds: string[]; topActive: string; bottomActive: string | null } {
  const { topIds, bottomIds } = computeDockSlots(openIds, dock.bottomTabIds)
  const topActive = topIds.includes(activePanel)
    ? activePanel
    : topIds.includes(dock.topActive)
      ? dock.topActive
      : (topIds[0] ?? '')
  const bottomActive =
    bottomIds.length > 0
      ? dock.bottomActive && bottomIds.includes(dock.bottomActive)
        ? dock.bottomActive
        : bottomIds[0]
      : null
  return { topIds, bottomIds, topActive, bottomActive }
}

export function getAllAvailableRightPanelIdsFromStore(): string[] {
  const ui = useUIStore.getState()
  const catalogIds = ui.rightPanelCatalog.map((c) => c.id)
  if (!ui.rightPanelOrder.length) return catalogIds
  const known = new Set(catalogIds)
  const ordered = ui.rightPanelOrder.filter((id) => known.has(id))
  for (const id of catalogIds) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

export function getEnabledRightPanelIdsFromStore(): string[] {
  const ui = useUIStore.getState()
  const baseOrder = getAllAvailableRightPanelIdsFromStore()
  return baseOrder.filter((id) => ui.rightPanelPrefs[id])
}

export function getOpenRightPanelIdsFromStore(): string[] {
  const dock = useRightDockStore.getState()
  const availableIds = getAllAvailableRightPanelIdsFromStore()
  return resolveOpenTabIds(availableIds, dock.openTabIds)
}

export function isPanelVisibleInRightDock(panelId: string): boolean {
  const ui = useUIStore.getState()
  const dock = useRightDockStore.getState()
  if (dock.launchpadOpen) return false
  const openIds = getOpenRightPanelIdsFromStore()
  if (openIds.length === 0) return false
  const { topActive, bottomActive } = resolveVisibleDockPanels(openIds, ui.activePanel, dock)
  return topActive === panelId || bottomActive === panelId
}

function collapseRightPanelCleanly(): void {
  useUIStore.setState({
    rightPanelCollapsed: true,
    rightPanelExpandedOnNarrow: false,
    browserChatExpand: false,
    canvasChatExpand: false,
    filesPreviewChatExpand: false,
  })
}

export const useRightDockStore = create<RightDockState>()(
  persist(
    (set, get) => ({
      openTabIds: [],
      bottomTabIds: [],
      topActive: '',
      bottomActive: null,
      launchpadOpen: false,
      splitRatio: 0.5,
      workspaceMemory: {},

      setLaunchpadOpen: (open) => set({ launchpadOpen: open }),

      setSplitRatio: (ratio) => set({ splitRatio: Math.max(0.22, Math.min(0.78, ratio)) }),

      resetSplitRatio: () => set({ splitRatio: 0.5 }),

      activateInSlot: (slot, panelId, openIds) => {
        const { topIds, bottomIds } = computeDockSlots(openIds, get().bottomTabIds)
        if (slot === 'top' && topIds.includes(panelId)) {
          set({ topActive: panelId, launchpadOpen: false })
          useUIStore.getState().setActivePanel(panelId)
        } else if (slot === 'bottom' && bottomIds.includes(panelId)) {
          set({ bottomActive: panelId, launchpadOpen: false })
        }
      },

      openTab: (panelId, opts) => {
        const ui = useUIStore.getState()
        const cur = get()
        const alreadyOpen = cur.openTabIds.includes(panelId)
        const nextOpen = alreadyOpen ? cur.openTabIds : [...cur.openTabIds, panelId]

        if (opts?.slot === 'bottom' && nextOpen.length > 1) {
          const nextBottom = cur.bottomTabIds.includes(panelId)
            ? cur.bottomTabIds
            : [...cur.bottomTabIds, panelId]
          const { topIds } = computeDockSlots(nextOpen, nextBottom)
          const nextTopActive =
            cur.topActive && topIds.includes(cur.topActive) ? cur.topActive : (topIds[0] ?? panelId)
          set({
            openTabIds: nextOpen,
            bottomTabIds: nextBottom,
            topActive: nextTopActive,
            bottomActive: panelId,
            launchpadOpen: false,
          })
          return 'bottom'
        }

        const { bottomIds } = computeDockSlots(nextOpen, cur.bottomTabIds)
        if (bottomIds.includes(panelId)) {
          set({ openTabIds: nextOpen, bottomActive: panelId, launchpadOpen: false })
          return 'bottom'
        }
        set({ openTabIds: nextOpen, topActive: panelId, launchpadOpen: false })
        if (opts?.focus !== false) {
          if (!ui.rightPanelPrefs[panelId]) {
            // Keep activePanel aligned even for on-demand panels not pinned in Settings prefs.
            useUIStore.setState({ activePanel: panelId })
          } else {
            ui.setActivePanel(panelId)
          }
        }
        return 'top'
      },

      activatePanelSmart: (panelId, _availableIds) => {
        return get().openTab(panelId, { focus: true })
      },

      closeTab: (panelId) => {
        const cur = get()
        const ui = useUIStore.getState()
        const effectiveOpen =
          cur.openTabIds.length > 0
            ? cur.openTabIds
            : ui.activePanel
              ? [ui.activePanel]
              : []
        const idx = effectiveOpen.indexOf(panelId)
        if (idx < 0) return

        const nextOpen = effectiveOpen.filter((id) => id !== panelId)
        if (panelId === 'browser' && ui.browserChatExpand) {
          useUIStore.setState({ browserChatExpand: false })
        }
        if (panelId === 'canvas' && ui.canvasChatExpand) {
          useUIStore.setState({ canvasChatExpand: false })
        }
        if (panelId === 'files' && ui.filesPreviewChatExpand) {
          useUIStore.setState({ filesPreviewChatExpand: false })
        }

        if (nextOpen.length === 0) {
          set({
            openTabIds: [],
            bottomTabIds: [],
            topActive: '',
            bottomActive: null,
            launchpadOpen: !ui.rightPanelCollapsed,
          })
          return
        }

        const rawNextBottom = cur.bottomTabIds.filter((id) => id !== panelId)
        const { topIds, bottomIds } = computeDockSlots(nextOpen, rawNextBottom)

        const pickNeighbor = (list: string[], previousActive: string | null) => {
          if (previousActive && list.includes(previousActive)) return previousActive
          return list[Math.min(idx, list.length - 1)] ?? list[0] ?? ''
        }

        const nextTopActive = pickNeighbor(topIds, cur.topActive === panelId ? null : cur.topActive)
        const nextBottomActive =
          bottomIds.length === 0
            ? null
            : cur.bottomActive && cur.bottomActive !== panelId && bottomIds.includes(cur.bottomActive)
              ? cur.bottomActive
              : bottomIds[0]

        set({
          openTabIds: nextOpen,
          bottomTabIds: bottomIds,
          topActive: nextTopActive,
          bottomActive: nextBottomActive,
        })
        if (nextTopActive) {
          useUIStore.setState({ activePanel: nextTopActive })
        }
      },

      closeOtherTabs: (keepPanelId) => {
        const cur = get()
        if (!cur.openTabIds.includes(keepPanelId)) return
        set({
          openTabIds: [keepPanelId],
          bottomTabIds: [],
          topActive: keepPanelId,
          bottomActive: null,
          launchpadOpen: false,
        })
        useUIStore.setState({ activePanel: keepPanelId })
      },

      closeAllTabs: () => {
        set({
          openTabIds: [],
          bottomTabIds: [],
          topActive: '',
          bottomActive: null,
          launchpadOpen: false,
        })
        collapseRightPanelCleanly()
      },

      movePanel: (panelId, targetSlot, openIds, targetIndex) => {
        if (openIds.length <= 1) return
        const cur = get()
        const { topIds, bottomIds } = computeDockSlots(openIds, cur.bottomTabIds)

        if (targetSlot === 'bottom') {
          if (topIds.length <= 1 && topIds[0] === panelId) return
          const nextBottom = bottomIds.filter((id) => id !== panelId)
          const insertAt =
            targetIndex === undefined
              ? nextBottom.length
              : Math.max(0, Math.min(nextBottom.length, targetIndex))
          nextBottom.splice(insertAt, 0, panelId)
          const nextTop = openIds.filter((id) => !nextBottom.includes(id))
          const uiActive = useUIStore.getState().activePanel
          const nextTopActive =
            uiActive !== panelId && nextTop.includes(uiActive)
              ? uiActive
              : cur.topActive !== panelId && nextTop.includes(cur.topActive)
                ? cur.topActive
                : (nextTop[0] ?? panelId)
          set({
            openTabIds: [...nextTop, ...nextBottom],
            bottomTabIds: nextBottom,
            topActive: nextTopActive,
            bottomActive: panelId,
          })
          useUIStore.setState({ activePanel: nextTopActive })
          return
        }

        const nextBottom = bottomIds.filter((id) => id !== panelId)
        const nextTop = topIds.filter((id) => id !== panelId)
        const insertAt =
          targetIndex === undefined
            ? nextTop.length
            : Math.max(0, Math.min(nextTop.length, targetIndex))
        nextTop.splice(insertAt, 0, panelId)

        const nextBottomActive =
          nextBottom.length === 0
            ? null
            : cur.bottomActive && nextBottom.includes(cur.bottomActive)
              ? cur.bottomActive
              : nextBottom[0]
        set({
          openTabIds: [...nextTop, ...nextBottom],
          bottomTabIds: nextBottom,
          topActive: panelId,
          bottomActive: nextBottomActive,
        })
        useUIStore.setState({ activePanel: panelId })
      },

      splitToBottom: (openIds, preferredBottomId) => {
        if (openIds.length <= 1) return
        const uiActive = useUIStore.getState().activePanel
        const currentTop = openIds.includes(uiActive) ? uiActive : openIds[0]
        const candidate =
          preferredBottomId && openIds.includes(preferredBottomId) && preferredBottomId !== currentTop
            ? preferredBottomId
            : (openIds.find((id) => id !== currentTop) ?? openIds[openIds.length - 1])
        if (!candidate || candidate === currentTop) return
        set({
          bottomTabIds: [candidate],
          topActive: currentTop,
          bottomActive: candidate,
        })
      },

      mergeToSingle: () => set({ bottomTabIds: [], bottomActive: null }),

      swapPanes: (openIds) => {
        const cur = get()
        const { topIds, bottomIds } = computeDockSlots(openIds, cur.bottomTabIds)
        if (bottomIds.length === 0 || topIds.length === 0) return
        const uiActive = useUIStore.getState().activePanel
        const prevTopActive = topIds.includes(uiActive) ? uiActive : topIds[0]
        const prevBottomActive =
          cur.bottomActive && bottomIds.includes(cur.bottomActive) ? cur.bottomActive : bottomIds[0]
        const nextOrder = [...bottomIds, ...topIds]
        useUIStore.setState({ activePanel: prevBottomActive })
        set({
          openTabIds: cur.openTabIds.length > 0 ? nextOrder : cur.openTabIds,
          bottomTabIds: topIds,
          topActive: prevBottomActive,
          bottomActive: prevTopActive,
          splitRatio: Number((1 - cur.splitRatio).toFixed(3)),
        })
      },

      reconcile: (availableIds, fallbackTop) => {
        const cur = get()
        const validOpen = resolveOpenTabIds(availableIds, cur.openTabIds)
        const { topIds, bottomIds } = computeDockSlots(validOpen, cur.bottomTabIds)
        const nextTop =
          topIds.length === 0
            ? ''
            : topIds.includes(fallbackTop)
              ? fallbackTop
              : topIds.includes(cur.topActive)
                ? cur.topActive
                : topIds[0]
        const nextBottom =
          bottomIds.length === 0
            ? null
            : cur.bottomActive && bottomIds.includes(cur.bottomActive)
              ? cur.bottomActive
              : bottomIds[0]
        if (
          validOpen.join(',') !== cur.openTabIds.join(',') ||
          bottomIds.join(',') !== cur.bottomTabIds.join(',') ||
          nextTop !== cur.topActive ||
          nextBottom !== cur.bottomActive
        ) {
          set({
            openTabIds: validOpen,
            bottomTabIds: bottomIds,
            topActive: nextTop,
            bottomActive: nextBottom,
          })
        }
      },

      rememberWorkspace: (workspaceKey, topActive, bottomActive) => {
        if (!workspaceKey || !topActive) return
        set((s) => ({
          workspaceMemory: {
            ...s.workspaceMemory,
            [workspaceKey]: { topActive, bottomActive },
          },
        }))
      },

      restoreWorkspace: (workspaceKey, availableIds) => {
        if (!workspaceKey) return
        const cur = get()
        const remembered = cur.workspaceMemory[workspaceKey]
        if (!remembered || cur.openTabIds.length === 0) return
        const validOpen = resolveOpenTabIds(availableIds, cur.openTabIds)
        const { topIds, bottomIds } = computeDockSlots(validOpen, cur.bottomTabIds)
        const nextTop = topIds.includes(remembered.topActive) ? remembered.topActive : cur.topActive
        const nextBottom =
          bottomIds.length > 0 && remembered.bottomActive && bottomIds.includes(remembered.bottomActive)
            ? remembered.bottomActive
            : cur.bottomActive
        if (nextTop !== cur.topActive || nextBottom !== cur.bottomActive) {
          set({ topActive: nextTop, bottomActive: nextBottom })
          if (nextTop && topIds.includes(nextTop)) useUIStore.setState({ activePanel: nextTop })
        }
      },
    }),
    {
      name: 'pi-right-dock-v2',
      partialize: (s) => ({
        openTabIds: s.openTabIds,
        bottomTabIds: s.bottomTabIds,
        topActive: s.topActive,
        bottomActive: s.bottomActive,
        splitRatio: s.splitRatio,
        workspaceMemory: s.workspaceMemory,
      }),
    },
  ),
)
