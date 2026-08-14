import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { applyAppEvent } from '@renderer/stores/apply-app-event'
import { sanitizeRunStatePatch } from '@renderer/lib/format-run-display'
import {
  dedupeAdjacentUserMessages,
  sanitizeHistoryTimeline,
} from '@renderer/lib/timeline-dedupe'
import { projectTimelineItems } from '@shared/timeline-projection'
import { isViewingWorkerBoundSession } from '@renderer/lib/session-worker-sync'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { FileChange, RunState, TimelineItem, UIState } from '@renderer/stores/ui-store-types'
import {
  clearStreamPending,
  deleteStreamPendingForId,
  flushStreamPendingSync,
  queueStreamDelta,
} from '@renderer/stores/ui-store-stream'
import { createShellSlice } from '@renderer/stores/ui-store-shell-slice'
import { createRuntimeSlice } from '@renderer/stores/ui-store-runtime-slice'
import { isAbortQueueIgnoreActive } from '@renderer/lib/abort-ui-hold'

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
        // 不在此处重排 recentProjects：侧栏顺序以主进程配置为准（reloadSidebarSettings 同步），
        // 此处 unshift 会让固定顺序模式下列表先跳顶再弹回（闪烁），MRU 模式也由磁盘路径列表当前置顶兜底。
        ...(changed
          ? {
            sessions: [],
            currentSessionId: null,
            subagentSessionGroup: null,
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
        subagentSessionGroup: null,
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
    const {
      lastModel,
      lastThinking,
      runState,
      streamingAssistantId,
      historySessionFile,
      workerLiveSnapshot,
      sessionRuntimeRunning,
      optimisticPendingUserText,
      agentTurnBootstrapping,
    } = get()
    const viewingWorkerSession = isViewingWorkerBoundSession(historySessionFile, workerLiveSnapshot.sessionFile)
    let runtimeHere = false
    if (historySessionFile && sessionRuntimeRunning) {
      const viewKey = normalizeSessionFileKey(historySessionFile)
      runtimeHere =
        sessionRuntimeRunning[historySessionFile] === true ||
        sessionRuntimeRunning[viewKey] === true ||
        Object.entries(sessionRuntimeRunning).some(
          ([runtimeKey, running]) => running && sessionFilesEqual(runtimeKey, historySessionFile),
        )
    }
    const localTurn =
      streamingAssistantId != null ||
      optimisticPendingUserText != null ||
      agentTurnBootstrapping === true
    // Only keep running when *this* session is actually live.
    // Do NOT use residual runState.status alone — that re-lit "running" after switch
    // whenever history finished loading (race: A still running globally, B's loadHistory).
    const keepRunning =
      runtimeHere ||
      localTurn ||
      (viewingWorkerSession && workerLiveSnapshot.status === 'running')
    const cleaned = projectTimelineItems(sanitizeHistoryTimeline(items))
    set({
      timelineItems: cleaned,
      streamingAssistantId: keepRunning ? streamingAssistantId : null,
      fileChanges: [],
      // 完整历史重载 = 视图已同步：外部同步指示随之消除（避免跨会话残留）
      externalSyncPhase: 'idle',
      runState: {
        ...runState,
        status: keepRunning ? 'running' : 'idle',
        activeTool: undefined,
        activeToolStatus: undefined,
        // Drop activeRunId when forcing idle so chrome/composer cannot re-attach.
        ...(keepRunning ? {} : { activeRunId: undefined }),
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
  /** 外部（如 CLI）会话同步状态 */
  externalSyncPhase: 'idle' as 'idle' | 'active' | 'error',
  setHistoryMeta: (total, loaded, sessionFile) =>
    set({ historyTotalCount: total, historyLoadedCount: loaded, historySessionFile: sessionFile }),
  setHistoryLoading: (v) => set({ historyLoading: v }),
  setExternalSyncPhase: (phase) => set({ externalSyncPhase: phase }),
  subagentSessionGroup: null,
  setSubagentSessionGroup: (group) => set({ subagentSessionGroup: group }),

  timelineItems: [],
  streamingAssistantId: null,
  appendTimeline: (item) => set((s) => ({ timelineItems: [...s.timelineItems, item] })),
  insertTimelineBefore: (beforeId, item) =>
    set((s) => {
      const idx = s.timelineItems.findIndex((i) => i.id === beforeId)
      if (idx < 0) return { timelineItems: [...s.timelineItems, item] }
      const next = [...s.timelineItems]
      next.splice(idx, 0, item)
      return { timelineItems: next }
    }),
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
        if (i.incomplete) return true
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
        timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, text: text ?? i.text } : i)),
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
    const next = { ...s.runState } as RunState & Record<string, unknown>
    const extra: Partial<UIState> = {}
    for (const [key, value] of Object.entries(clean)) {
      if (key === 'model') {
        if (value == null || value === '') {
          delete next.model
        } else {
          next.model = value as string
          extra.lastModel = value as string
        }
        continue
      }
      if (key === 'thinkingLevel') {
        if (value == null || value === '') {
          delete next.thinkingLevel
        } else {
          next.thinkingLevel = value as string
          extra.lastThinking = value as string
        }
        continue
      }
      next[key] = value
    }
    return { runState: next as RunState, ...extra }
  }),

  compactingSessions: {},
  setCompactingSession: (sessionFile, active) =>
    set((s) => {
      const key = sessionFile ? normalizeSessionFileKey(sessionFile) || sessionFile : ''
      return { compactingSessions: { ...s.compactingSessions, [key]: active } }
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
  composerPrefillMode: 'replace' as const,
  setComposerPrefill: (text) => set({ composerPrefill: text, composerPrefillMode: 'replace' }),
  appendComposerPrefill: (text) => {
    const snippet = String(text || '').trimEnd()
    if (!snippet) return
    set((s) => {
      if (s.composerPrefill != null && s.composerPrefillMode === 'append') {
        return {
          composerPrefill: `${s.composerPrefill.replace(/\s+$/, '')}\n${snippet}`,
          composerPrefillMode: 'append' as const,
        }
      }
      return { composerPrefill: snippet, composerPrefillMode: 'append' as const }
    })
  },

  ...createShellSlice(set, get),
  ...createRuntimeSlice(set),
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
  composerWidget: null,
  adapterWidgetExpandedBySession: {},
  setComposerWidget: (state) => set({ composerWidget: state }),
  toggleAdapterWidget: (key) =>
    set((s) => ({
      adapterWidgetExpandedBySession: {
        ...s.adapterWidgetExpandedBySession,
        [key]: !s.adapterWidgetExpandedBySession[key],
      },
    })),
  setPendingQueue: (steering, followUp) => {
    const state = get()
    if (isAbortQueueIgnoreActive(state.historySessionFile)) {
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
        recentProjects: s.recentProjects,
        activePanel: s.activePanel,
        theme: s.theme,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        rightPanelWidth: s.rightPanelWidth,
        rightPanelCollapsed: s.rightPanelCollapsed,
        rightPanelExpandedOnNarrow: s.rightPanelExpandedOnNarrow,
        lastModel: s.lastModel,
        lastThinking: s.lastThinking,
      }),
      version: 3,
      migrate: (persistedState) => {
        const p = persistedState as Partial<UIState>
        return {
          ...p,
          currentWorkspace: null,
          rightPanelWidth: 288,
          rightPanelCollapsed: false,
        } as UIState
      },
    },
  ),
)
