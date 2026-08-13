export const RIGHT_PANEL_NARROW_MAX = 1100

export function isRightPanelHidden(input: {
  collapsed: boolean
  expandedOnNarrow: boolean
  windowWidth: number
}): boolean {
  if (input.collapsed) return true
  if (input.windowWidth > 0 && input.windowWidth < RIGHT_PANEL_NARROW_MAX && !input.expandedOnNarrow) {
    return true
  }
  return false
}

export function nextRightPanelToggle(input: {
  hidden: boolean
  windowWidth: number
}): { rightPanelCollapsed: boolean; rightPanelExpandedOnNarrow: boolean } {
  if (input.hidden) {
    return {
      rightPanelCollapsed: false,
      rightPanelExpandedOnNarrow: input.windowWidth > 0 && input.windowWidth < RIGHT_PANEL_NARROW_MAX,
    }
  }
  return {
    rightPanelCollapsed: true,
    rightPanelExpandedOnNarrow: false,
  }
}

export function revealRightPanelPatch(windowWidth = currentWindowWidth()): {
  rightPanelCollapsed: boolean
  rightPanelExpandedOnNarrow: boolean
} {
  return {
    rightPanelCollapsed: false,
    rightPanelExpandedOnNarrow: windowWidth > 0 && windowWidth < RIGHT_PANEL_NARROW_MAX,
  }
}

export function currentWindowWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth
}
