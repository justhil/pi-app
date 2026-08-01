import {
  coerceActivePanel,
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
} from '@shared/right-panels'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from '@shared/timeline-settings'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import type { UIState } from '@renderer/stores/ui-store-types'

type StoreSet = (
  patch: Partial<UIState> | ((state: UIState) => Partial<UIState> | UIState),
) => void
type StoreGet = () => UIState

type ShellSlice = Pick<
  UIState,
  | 'activePanel'
  | 'setActivePanel'
  | 'rightPanelCatalog'
  | 'rightPanelPrefs'
  | 'rightPanelOrder'
  | 'applyRightPanelRuntime'
  | 'theme'
  | 'setTheme'
  | 'toolExpandBySession'
  | 'setToolCallExpanded'
  | 'getToolCallExpanded'
  | 'timelineMaxAutoExpandedTools'
  | 'setTimelineMaxAutoExpandedTools'
  | 'sidebarWidth'
  | 'setSidebarWidth'
  | 'sidebarCollapsed'
  | 'toggleSidebar'
  | 'rightPanelWidth'
  | 'setRightPanelWidth'
  | 'rightPanelCollapsed'
  | 'toggleRightPanel'
  | 'filesPreviewChatExpand'
>

export function createShellSlice(set: StoreSet, get: StoreGet): ShellSlice {
  return {
    activePanel: 'review',
    rightPanelCatalog: [...CORE_RIGHT_PANEL_CATALOG],
    setActivePanel: (panel) =>
      set((state) => ({
        activePanel: state.rightPanelPrefs[panel]
          ? panel
          : coerceActivePanel(
              panel,
              state.rightPanelPrefs,
              state.rightPanelCatalog,
              state.rightPanelOrder,
            ),
      })),
    rightPanelPrefs: defaultCoreRightPanelPrefs(),
    rightPanelOrder: [],
    applyRightPanelRuntime: (catalog, prefs, order) =>
      set((state) => {
        const nextOrder = order?.length ? order : state.rightPanelOrder
        return {
          rightPanelCatalog: catalog,
          rightPanelPrefs: prefs,
          rightPanelOrder: nextOrder,
          activePanel: coerceActivePanel(state.activePanel, prefs, catalog, nextOrder),
        }
      }),
    theme: 'system',
    setTheme: (theme) => set({ theme }),
    toolExpandBySession: {},
    setToolCallExpanded: (toolCallId, expanded) =>
      set((state) => {
        const sessionKey =
          normalizeSessionFileKey(state.historySessionFile || '') ||
          state.historySessionFile ||
          '__none__'
        if (!toolCallId) return state
        const sessionMap = { ...(state.toolExpandBySession[sessionKey] || {}) }
        if (expanded == null) delete sessionMap[toolCallId]
        else sessionMap[toolCallId] = expanded
        return {
          toolExpandBySession: {
            ...state.toolExpandBySession,
            [sessionKey]: sessionMap,
          },
        }
      }),
    getToolCallExpanded: (toolCallId) => {
      if (!toolCallId) return undefined
      const state = get()
      const sessionKey =
        normalizeSessionFileKey(state.historySessionFile || '') ||
        state.historySessionFile ||
        '__none__'
      return state.toolExpandBySession[sessionKey]?.[toolCallId]
    },
    timelineMaxAutoExpandedTools: DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
    setTimelineMaxAutoExpandedTools: (count) =>
      set({ timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(count) }),
    sidebarWidth: 260,
    setSidebarWidth: (width) => set({ sidebarWidth: Math.min(Math.max(width, 200), 360) }),
    sidebarCollapsed: false,
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    rightPanelWidth: 288,
    setRightPanelWidth: (width) =>
      set({ rightPanelWidth: Math.min(Math.max(width, 280), 9999) }),
    rightPanelCollapsed: false,
    toggleRightPanel: () =>
      set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
    filesPreviewChatExpand: false,
  }
}
