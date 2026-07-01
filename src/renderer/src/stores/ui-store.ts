import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { applyAppEvent } from '@renderer/stores/apply-app-event'
import {
  coerceActivePanel,
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
} from '@shared/right-panels'
import { sanitizeRunStatePatch } from '@renderer/lib/format-run-display'
import {
  dedupeAdjacentUserMessages,
  sanitizeHistoryTimeline,
} from '@renderer/lib/timeline-dedupe'
import { isViewingWorkerBoundSession } from '@renderer/lib/session-worker-sync'
import type { FileChange, TimelineItem, UIState } from '@renderer/stores/ui-store-types'
import {
  clearStreamPending,
  deleteStreamPendingForId,
  flushStreamPendingSync,
  queueStreamDelta,
} from '@renderer/stores/ui-store-stream'

export type { TimelineItem, UIState } from '@renderer/stores/ui-store-types'

let itemSeq = 0
function nextItemId(): string {
  return `item-${++itemSeq}`
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
  currentWorkspace: null,
  recentProjects: [],
  ephemeralSandboxDraft: false,
  pendingNewSessionPlaceholder: false,
  enterEphemeralSandboxDraft: () => {
    set({
      ephemeralSandboxDraft: true,
      pendingNewSessionPlaceholder: false,
      currentWorkspace: null,
      currentSessionId: '__ephemeral_draft__',
      timelineItems: [],
      streamingAssistantId: null,
      fileChanges: [],
      historyTotalCount: 0,
      historyLoadedCount: 0,
      historySessionFile: null,
      historyLoading: false,
    })
    void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
      ipcClient.invoke('session.setEphemeralDraft', { active: true }).catch(() => {}),
    )
    void import('@renderer/stores/extension-ui-store').then(({ useExtensionUIStore }) =>
      useExtensionUIStore.getState().resetForSessionContext(),
    )
  },
  enterPendingNewSessionPlaceholder: (opts) => {
    const keep = opts?.keepTimeline === true
    set({
      pendingNewSessionPlaceholder: true,
      ephemeralSandboxDraft: false,
      currentSessionId: '__pending_new__',
      ...(keep
        ? {}
        : {
            timelineItems: [],
            streamingAssistantId: null,
            fileChanges: [],
            historyTotalCount: 0,
            historyLoadedCount: 0,
            historySessionFile: null,
            historyLoading: false,
          }),
    })
    void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
      ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {}),
    )
    void import('@renderer/stores/extension-ui-store').then(({ useExtensionUIStore }) =>
      useExtensionUIStore.getState().resetForSessionContext(),
    )
  },
  clearPendingNewSessionPlaceholder: () => {
    set({ pendingNewSessionPlaceholder: false })
  },
  clearEphemeralSandboxDraft: () => {
    set({ ephemeralSandboxDraft: false })
    void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
      ipcClient.invoke('session.setEphemeralDraft', { active: false }).catch(() => {}),
    )
  },
  setWorkspace: (path) =>
    set((s) => {
      const changed = path !== s.currentWorkspace
      return {
        currentWorkspace: path,
        ephemeralSandboxDraft: false,
        pendingNewSessionPlaceholder: false,
        recentProjects: path
          ? [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, 16)
          : s.recentProjects,
        ...(changed
          ? {
              sessions: [],
              currentSessionId: null,
            }
          : {}),
      }
    }),

  sessions: [],
  currentSessionId: null,
  setSessions: (s) => set({ sessions: s }),
  setCurrentSession: (id) => {
    if (id === null) {
      set({
        currentSessionId: null,
        rewindTreeNodes: [],
        rewindWorkerBound: false,
        rewindLoadingTree: false,
      })
      return
    }
    set({
      currentSessionId: id,
      rewindTreeNodes: [],
      rewindWorkerBound: false,
      rewindLoadingTree: true,
    })
  },
  loadHistoryItems: (items: TimelineItem[]) => {
    const { lastModel, lastThinking, runState, streamingAssistantId, historySessionFile, workerLiveSnapshot } = get()
    const viewingWorkerSession = isViewingWorkerBoundSession(historySessionFile, workerLiveSnapshot.sessionFile)
    const keepRunning =
      viewingWorkerSession && (runState.status === 'running' || streamingAssistantId != null || workerLiveSnapshot.status === 'running')
    const cleaned = sanitizeHistoryTimeline(items)
    set({
      timelineItems: cleaned,
      streamingAssistantId: keepRunning ? streamingAssistantId : null,
      fileChanges: [],
      runState: {
        ...runState,
        status: keepRunning ? 'running' : 'idle',
        activeTool: undefined,
        activeToolStatus: undefined,
        toolCount: 0,
        errorCount: 0,
        model: runState.model ?? lastModel ?? undefined,
        thinkingLevel: runState.thinkingLevel ?? lastThinking ?? undefined,
      },
    })
  },
  prependHistoryItems: (items) =>
    set((s) => {
      const merged = dedupeAdjacentUserMessages([...sanitizeHistoryTimeline(items), ...s.timelineItems])
      return {
        timelineItems: merged,
        historyLoadedCount: s.historyLoadedCount + items.length,
      }
    }),
  historyTotalCount: 0,
  historyLoadedCount: 0,
  historySessionFile: null,
  historyLoading: false,
  setHistoryMeta: (total, loaded, sessionFile) =>
    set({ historyTotalCount: total, historyLoadedCount: loaded, historySessionFile: sessionFile }),
  setHistoryLoading: (v) => set({ historyLoading: v }),

  timelineItems: [],
  streamingAssistantId: null,
  appendTimeline: (item) => set((s) => ({ timelineItems: [...s.timelineItems, item] })),
  updateTimelineItem: (id, patch) => set((s) => ({
    timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  })),
  appendDeltaToStreamingAssistant: (delta) => queueStreamDelta(get, set, 'text', delta),
  appendThinkingDelta: (delta) => queueStreamDelta(get, set, 'thinking', delta),
  pruneEmptyAssistantBubbles: () =>
    set((s) => {
      const sid = s.streamingAssistantId
      const items = s.timelineItems.filter((i) => {
        if (i.type !== 'assistant-message') return true
        const hasText = !!(i.text && i.text.trim())
        const hasThink = !!(i.thinkingText && i.thinkingText.trim())
        if (!hasText && !hasThink) return i.id !== sid
        return true
      })
      if (items.length === s.timelineItems.length) return s
      return { timelineItems: items }
    }),
  setStreamingAssistantFinalText: (text) => {
    flushStreamPendingSync(get, set)
    set((s) => {
      const id = s.streamingAssistantId
      if (!id) return { streamingAssistantId: null }
      deleteStreamPendingForId(id)
      return {
        streamingAssistantId: null,
        timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, text: i.text && i.text.trim() ? i.text : (text ?? i.text) } : i)),
      }
    })
  },
  clearTimeline: () => {
    clearStreamPending()
    set({ timelineItems: [], streamingAssistantId: null, optimisticPendingUserText: null, agentTurnBootstrapping: false })
  },

  workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
  setWorkerLiveSnapshot: (snap) => set({ workerLiveSnapshot: snap }),

  runState: { status: 'idle', toolCount: 0, errorCount: 0 },
  setRunState: (patch) => set((s) => {
    const clean = sanitizeRunStatePatch(patch as Record<string, unknown>)
    const next = { ...s.runState, ...clean }
    const extra: Partial<UIState> = {}
    if (clean.model !== undefined) extra.lastModel = clean.model as string
    if (clean.thinkingLevel !== undefined) extra.lastThinking = clean.thinkingLevel as string
    return { runState: next, ...extra }
  }),

  fileChanges: [],
  addFileChange: (fc) => set((s) => ({ fileChanges: [...s.fileChanges.filter(f => f.path !== fc.path), fc] })),
  clearFileChanges: () => set({ fileChanges: [] }),

  rewindKey: '',
  rewindCheckpoints: [],
  rewindTreeNodes: [],
  rewindWorkerBound: false,
  rewindLoadingCheckpoints: false,
  rewindLoadingTree: false,
  rewindTreeError: undefined,
  setRewindMeta: (patch) =>
    set((s) => ({
      ...(patch.rewindKey !== undefined ? { rewindKey: patch.rewindKey } : {}),
      ...(patch.checkpoints !== undefined ? { rewindCheckpoints: patch.checkpoints } : {}),
      ...(patch.treeNodes !== undefined ? { rewindTreeNodes: patch.treeNodes } : {}),
      ...(patch.workerBound !== undefined ? { rewindWorkerBound: patch.workerBound } : {}),
      ...(patch.loadingCheckpoints !== undefined ? { rewindLoadingCheckpoints: patch.loadingCheckpoints } : {}),
      ...(patch.loadingTree !== undefined ? { rewindLoadingTree: patch.loadingTree } : {}),
      ...(patch.treeError !== undefined ? { rewindTreeError: patch.treeError } : {}),
    })),

  composerPrefill: null,
  setComposerPrefill: (text) => set({ composerPrefill: text }),

  activePanel: 'review',
  rightPanelCatalog: [...CORE_RIGHT_PANEL_CATALOG],
  setActivePanel: (p) =>
    set((s) => ({
      activePanel: s.rightPanelPrefs[p]
        ? p
        : coerceActivePanel(p, s.rightPanelPrefs, s.rightPanelCatalog, s.rightPanelOrder),
    })),
  rightPanelPrefs: defaultCoreRightPanelPrefs(),
  rightPanelOrder: [],
  applyRightPanelRuntime: (catalog, prefs, order) =>
    set((s) => {
      const nextOrder = order?.length ? order : s.rightPanelOrder
      return {
        rightPanelCatalog: catalog,
        rightPanelPrefs: prefs,
        rightPanelOrder: nextOrder,
        activePanel: coerceActivePanel(s.activePanel, prefs, catalog, nextOrder),
      }
    }),

  theme: 'system',
  setTheme: (t) => set({ theme: t }),
  sidebarWidth: 260,
  setSidebarWidth: (w) => set({ sidebarWidth: Math.min(Math.max(w, 200), 360) }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  rightPanelWidth: 288,
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.min(Math.max(w, 280), 720) }),
  rightPanelCollapsed: false,
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  filesPreviewChatExpand: false,

  lastModel: null,
  lastThinking: null,
  rememberModel: (model) => set({ lastModel: model }),
  rememberThinking: (level) => set({ lastThinking: level }),

  pendingExtensionConfig: null,
  requestExtensionConfig: (pluginName) => set({ pendingExtensionConfig: pluginName }),

  modelPickerOpen: false,
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),

  thinkingPickerOpen: false,
  setThinkingPickerOpen: (open) => set({ thinkingPickerOpen: open }),

  optimisticPendingUserText: null,
  agentTurnBootstrapping: false,
  pendingSteering: [],
  pendingFollowUp: [],
  ignoreQueueSyncUntil: 0,
  markAbortQueueIgnore: (ms = 5000) => set({ ignoreQueueSyncUntil: Date.now() + ms }),
  setPendingQueue: (steering, followUp) => {
    if (Date.now() < get().ignoreQueueSyncUntil) {
      const hasQueued = steering.length > 0 || followUp.length > 0
      if (hasQueued) return
    }
    set({ pendingSteering: steering, pendingFollowUp: followUp })
  },
  clearPendingQueue: () => set({ pendingSteering: [], pendingFollowUp: [] }),

  processEvent: (event) => {
    applyAppEvent(event, { get, set: (p) => set(p), nextItemId })
  },
    }),
    {
      name: 'pi-desktop-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentWorkspace: s.currentWorkspace,
        recentProjects: s.recentProjects,
        activePanel: s.activePanel,
        theme: s.theme,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        rightPanelWidth: s.rightPanelWidth,
        rightPanelCollapsed: s.rightPanelCollapsed,
        lastModel: s.lastModel,
        lastThinking: s.lastThinking,
      }),
      version: 1,
    },
  ),
)
