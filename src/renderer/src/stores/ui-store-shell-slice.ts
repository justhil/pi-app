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
  | 'skillExpandBySession'
  | 'setSkillInvocationExpanded'
  | 'getSkillInvocationExpanded'
  | 'timelineMaxAutoExpandedTools'
  | 'setTimelineMaxAutoExpandedTools'
  | 'showNonMessageEntries'
  | 'setShowNonMessageEntries'
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
    skillExpandBySession: {},
    setSkillInvocationExpanded: (itemId, expanded) =>
      set((state) => {
        const sessionKey =
          normalizeSessionFileKey(state.historySessionFile || '') ||
          state.historySessionFile ||
          '__none__'
        if (!itemId) return state
        const sessionMap = { ...(state.skillExpandBySession[sessionKey] || {}) }
        if (expanded == null) delete sessionMap[itemId]
        else sessionMap[itemId] = expanded
        return {
          skillExpandBySession: {
            ...state.skillExpandBySession,
            [sessionKey]: sessionMap,
          },
        }
      }),
    getSkillInvocationExpanded: (itemId) => {
      if (!itemId) return undefined
      const state = get()
      const sessionKey =
        normalizeSessionFileKey(state.historySessionFile || '') ||
        state.historySessionFile ||
        '__none__'
      return state.skillExpandBySession[sessionKey]?.[itemId]
    },
    timelineMaxAutoExpandedTools: DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
    setTimelineMaxAutoExpandedTools: (count) =>
      set({ timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(count) }),
    showNonMessageEntries: false,
    setShowNonMessageEntries: (v) => set({ showNonMessageEntries: v === true }),
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
