import {
  coerceActivePanel,
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
} from '@shared/right-panels'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
  normalizeTimelineVisibleTurns,
  DEFAULT_TIMELINE_VISIBLE_TURNS,
  normalizeTimelineUserMessageStyle,
  DEFAULT_TIMELINE_USER_MESSAGE_STYLE,
} from '@shared/timeline-settings'
import {
  DEFAULT_UI_CUSTOMIZATION,
  normalizeUiCustomization,
} from '@shared/ui-customization'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import {
  currentWindowWidth,
  isRightPanelHidden,
  nextRightPanelToggle,
  revealRightPanelPatch,
} from '@renderer/lib/right-panel-visibility'
import type { UIState } from '@renderer/stores/ui-store-types'

/** Wide enough for the browser toolbar to keep forward / expand on one row. */
export const DEFAULT_RIGHT_PANEL_WIDTH = 460

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
  | 'timelineVisibleTurns'
  | 'setTimelineVisibleTurns'
  | 'timelineUserMessageStyle'
  | 'setTimelineUserMessageStyle'
  | 'uiCustomization'
  | 'setUiCustomization'
  | 'sidebarWidth'
  | 'setSidebarWidth'
  | 'sidebarCollapsed'
  | 'setSidebarCollapsed'
  | 'toggleSidebar'
  | 'sidebarActiveSessionsDrawer'
  | 'setSidebarActiveSessionsDrawer'
  | 'sidebarActiveSessionsOpen'
  | 'setSidebarActiveSessionsOpen'
  | 'rightPanelWidth'
  | 'setRightPanelWidth'
  | 'rightPanelBrowserWidth'
  | 'setRightPanelBrowserWidth'
  | 'pinnedSessions'
  | 'pinnedSessionMeta'
  | 'setPinnedSessions'
  | 'upsertPinnedSessionMeta'
  | 'togglePinSession'
  | 'rightPanelCollapsed'
  | 'rightPanelRailIcons'
  | 'setRightPanelRailIcons'
  | 'rightPanelExpandedOnNarrow'
  | 'toggleRightPanel'
  | 'revealRightPanel'
  | 'filesPreviewChatExpand'
  | 'browserChatExpand'
  | 'canvasChatExpand'
  | 'browserStageMode'
  | 'browserStageRatio'
  | 'browserStageLastOpenMode'
  | 'setBrowserStageMode'
  | 'setBrowserStageRatio'
  | 'toggleBrowserStage'
>

export function createShellSlice(set: StoreSet, get: StoreGet): ShellSlice {
  return {
    activePanel: 'review',
    rightPanelCatalog: [...CORE_RIGHT_PANEL_CATALOG],
    setActivePanel: (panel) =>
      set((state) => {
        const known = state.rightPanelCatalog.some((c) => c.id === panel)
        return {
          activePanel: known
            ? panel
            : coerceActivePanel(
                panel,
                state.rightPanelPrefs,
                state.rightPanelCatalog,
                state.rightPanelOrder,
              ),
          ...(panel !== 'browser' && panel !== 'canvas' && state.browserStageMode !== 'closed'
            ? { browserStageMode: 'closed' as const, browserChatExpand: false }
            : {}),
          ...(panel !== 'canvas' && state.canvasChatExpand ? { canvasChatExpand: false } : {}),
        }
      }),
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
    timelineVisibleTurns: DEFAULT_TIMELINE_VISIBLE_TURNS,
    setTimelineVisibleTurns: (count) => set({ timelineVisibleTurns: normalizeTimelineVisibleTurns(count) }),
    timelineUserMessageStyle: DEFAULT_TIMELINE_USER_MESSAGE_STYLE,
    setTimelineUserMessageStyle: (style) =>
      set({ timelineUserMessageStyle: normalizeTimelineUserMessageStyle(style) }),
    uiCustomization: DEFAULT_UI_CUSTOMIZATION,
    setUiCustomization: (next) =>
      set((s) => ({
        uiCustomization: normalizeUiCustomization({ ...s.uiCustomization, ...next }),
      })),
    sidebarWidth: 260,
    setSidebarWidth: (width) => set({ sidebarWidth: Math.min(Math.max(width, 200), 360) }),
    sidebarCollapsed: false,
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    sidebarActiveSessionsDrawer: true,
    setSidebarActiveSessionsDrawer: (on) => set({ sidebarActiveSessionsDrawer: on }),
    sidebarActiveSessionsOpen: true,
    setSidebarActiveSessionsOpen: (open) => set({ sidebarActiveSessionsOpen: open }),
    rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    setRightPanelWidth: (width) =>
      set({ rightPanelWidth: Math.min(Math.max(width, 280), 9999) }),
    rightPanelBrowserWidth: 580,
    setRightPanelBrowserWidth: (width) =>
      set({ rightPanelBrowserWidth: Math.min(Math.max(width, 320), 9999) }),
    pinnedSessions: [],
    pinnedSessionMeta: {},
    setPinnedSessions: (files, meta) =>
      set((s) => ({
        pinnedSessions: [...new Set(files.filter(Boolean))],
        ...(meta ? { pinnedSessionMeta: { ...s.pinnedSessionMeta, ...meta } } : {}),
      })),
    upsertPinnedSessionMeta: (sessionFile, patch) => {
      const key = normalizeSessionFileKey(sessionFile)
      if (!key) return
      set((s) => {
        const prev = s.pinnedSessionMeta[key] ?? s.pinnedSessionMeta[key.toLowerCase()]
        return {
          pinnedSessionMeta: {
            ...s.pinnedSessionMeta,
            [key]: {
              sessionFile: prev?.sessionFile || sessionFile.trim(),
              sessionId: patch.sessionId ?? prev?.sessionId ?? '',
              workspacePath: patch.workspacePath ?? prev?.workspacePath ?? '',
              title: patch.title ?? prev?.title ?? '',
              kind: patch.kind ?? prev?.kind ?? 'project',
              pinnedAt: patch.pinnedAt ?? prev?.pinnedAt ?? Date.now(),
            },
          },
        }
      })
    },
    togglePinSession: (sessionFile, meta) => {
      const trimmed = sessionFile.trim()
      const key = normalizeSessionFileKey(trimmed)
      if (!key) return false
      const cur = get().pinnedSessions
      const exists = cur.some((f) => normalizeSessionFileKey(f) === key)
      if (exists) {
        const nextMeta = { ...get().pinnedSessionMeta }
        delete nextMeta[key]
        delete nextMeta[key.toLowerCase()]
        set({
          pinnedSessions: cur.filter((f) => normalizeSessionFileKey(f) !== key),
          pinnedSessionMeta: nextMeta,
        })
        return false
      }
      const nextMeta = {
        ...get().pinnedSessionMeta,
        [key]: {
          sessionFile: trimmed,
          sessionId: meta?.sessionId ?? '',
          workspacePath: meta?.workspacePath ?? '',
          title: meta?.title ?? '',
          kind: meta?.kind ?? 'project',
          pinnedAt: Date.now(),
        },
      }
      set({
        pinnedSessions: [trimmed, ...cur],
        pinnedSessionMeta: nextMeta,
      })
      return true
    },
    // Default to right pane open (showing Codex-style New Tab Launchpad when empty) and edge icon rail off.
    rightPanelCollapsed: false,
    rightPanelRailIcons: false,
    setRightPanelRailIcons: (on) => set({ rightPanelRailIcons: on }),
    rightPanelExpandedOnNarrow: false,
    toggleRightPanel: () =>
      set((state) => {
        const windowWidth = currentWindowWidth()
        const hidden = isRightPanelHidden({
          collapsed: state.rightPanelCollapsed,
          expandedOnNarrow: state.rightPanelExpandedOnNarrow,
          windowWidth,
        })
        return nextRightPanelToggle({ hidden, windowWidth })
      }),
    revealRightPanel: () => set({ ...revealRightPanelPatch(), browserStageMode: 'closed', browserChatExpand: false, canvasChatExpand: false }),
    filesPreviewChatExpand: false,
    browserChatExpand: false,
    canvasChatExpand: false,
    browserStageMode: 'closed',
    browserStageRatio: 0.5,
    browserStageLastOpenMode: 'split-50',
    setBrowserStageMode: (mode) =>
      set((s) => {
        if (mode === 'closed') {
          return { browserStageMode: 'closed', browserChatExpand: false }
        }
        const nextRatio =
          mode === 'split-50' ? 0.5 : mode === 'split-70' ? 0.68 : s.browserStageRatio
        return {
          browserStageMode: mode,
          browserStageLastOpenMode: mode,
          browserStageRatio: nextRatio,
          browserChatExpand: mode === 'full',
          canvasChatExpand: false,
          filesPreviewChatExpand: false,
          rightPanelCollapsed: true,
        }
      }),
    setBrowserStageRatio: (ratio) =>
      set({
        browserStageRatio: Math.max(0.32, Math.min(0.84, ratio)),
      }),
    toggleBrowserStage: () => {
      const s = get()
      if (s.browserStageMode !== 'closed') {
        s.setBrowserStageMode('closed')
      } else {
        s.setBrowserStageMode(s.browserStageLastOpenMode || 'split-50')
      }
    },
  }
}
