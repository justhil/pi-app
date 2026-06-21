import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AppEvent } from '@shared/app-events'
import {
  coerceActivePanel,
  defaultRightPanelPrefs,
  normalizeRightPanelPrefs,
  type RightPanelId,
  type RightPanelPrefs,
} from '@shared/right-panels'
import { sanitizeRunStatePatch } from '@renderer/lib/format-run-display'

// Generic status-line extractor (replaces pi-search-specific piSearchStatusFromUpdate).
// Pulls the first meaningful line from a tool update output, truncated for the timeline summary.
function extractStatusLine(output: unknown): string | null {
  if (!output) return null
  const text =
    typeof output === 'string'
      ? output
      : Array.isArray((output as any)?.content)
        ? (output as any).content.map((c: any) => c?.text || '').join('')
        : typeof (output as any)?.text === 'string'
          ? (output as any).text
          : ''
  const t = text.trim()
  if (!t) return null
  if (t.length > 120) return `${t.slice(0, 120)}…`
  return t
}

interface SessionItem {
  sessionId: string
  sessionFile?: string
  title: string
  updatedAt: number
  messageCount?: number
  modelId: string
}

interface RunState {
  status: 'idle' | 'running' | 'failed'
  /** 当前 agent 轮次 id，仅本轮工具/消息参与「运行中自动展开」 */
  activeRunId?: string
  /** 上一轮 runId，idle 后仍可用于「本轮」审查 */
  lastRunId?: string
  model?: string
  thinkingLevel?: string
  startTime?: number
  /** 上一轮结束时的耗时 ms，切换面板后仍显示 */
  lastRunDurationMs?: number
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
  toolCount: number
  errorCount: number
  activeTool?: string
  activeToolStatus?: string
}

interface TimelineItem {
  id: string
  type: 'user-message' | 'assistant-message' | 'tool-call' | 'compaction' | 'error' | 'slash'
  text?: string
  thinkingText?: string
  toolName?: string
  toolCallId?: string
  toolPhase?: string
  toolOutput?: string
  toolDetails?: any
  toolArgs?: any
  toolStatusLine?: string
  runId?: string
  isError?: boolean
  slashCommand?: string
  slashStatus?: 'dispatched' | 'ok' | 'error' | 'info'
  /** Pi session tree entry id (for navigateTree / rewind) */
  sessionEntryId?: string
  timestamp: number
}

interface FileChange {
  path: string
  source: string
  changeType: string
  turnId?: string
  runId?: string
}

interface UIState {
  // Workspace
  currentWorkspace: string | null
  recentProjects: string[]
  setWorkspace: (path: string | null) => void
  /** 已点「+」但尚未发首条消息，未创建 sandbox 目录 */
  ephemeralSandboxDraft: boolean
  enterEphemeralSandboxDraft: () => void
  clearEphemeralSandboxDraft: () => void

  // Sessions
  sessions: SessionItem[]
  currentSessionId: string | null
  setSessions: (s: SessionItem[]) => void
  setCurrentSession: (id: string) => void
  loadHistoryItems: (items: TimelineItem[]) => void
  prependHistoryItems: (items: TimelineItem[]) => void
  historyTotalCount: number
  historyLoadedCount: number
  historySessionFile: string | null
  historyLoading: boolean
  setHistoryMeta: (total: number, loaded: number, sessionFile: string | null) => void
  setHistoryLoading: (v: boolean) => void

  // Timeline
  timelineItems: TimelineItem[]
  streamingAssistantId: string | null
  appendTimeline: (item: TimelineItem) => void
  updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => void
  appendDeltaToStreamingAssistant: (delta: string) => void
  appendThinkingDelta: (delta: string) => void
  setStreamingAssistantFinalText: (text: string) => void
  pruneEmptyAssistantBubbles: () => void
  clearTimeline: () => void

  // Run
  runState: RunState
  setRunState: (patch: Partial<RunState>) => void

  // File changes
  fileChanges: FileChange[]
  addFileChange: (fc: FileChange) => void
  clearFileChanges: () => void

  /** TUI navigateTree: user-message target puts text here when editor was empty */
  composerPrefill: string | null
  setComposerPrefill: (text: string | null) => void

  // Panel
  activePanel: RightPanelId
  setActivePanel: (p: RightPanelId) => void
  rightPanelPrefs: RightPanelPrefs
  applyRightPanelPrefs: (prefs: RightPanelPrefs) => void

  rewindKey: string
  rewindCheckpoints: Array<{ id: string; trigger: string; description?: string; branch: string; timestamp: number }>
  rewindTreeNodes: Array<{ id: string; depth: number; label?: string; entryType: string; isLeaf: boolean }>
  rewindWorkerBound: boolean
  rewindLoadingCheckpoints: boolean
  rewindLoadingTree: boolean
  rewindTreeError?: string
  setRewindMeta: (patch: Partial<{
    rewindKey: string
    checkpoints: UIState['rewindCheckpoints']
    treeNodes: UIState['rewindTreeNodes']
    workerBound: boolean
    loadingCheckpoints: boolean
    loadingTree: boolean
    treeError: string
  }>) => void

  // Theme + layout (persisted)
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
  sidebarWidth: number
  setSidebarWidth: (w: number) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  rightPanelWidth: number
  setRightPanelWidth: (w: number) => void
  rightPanelCollapsed: boolean
  toggleRightPanel: () => void

  // Last picker selections (persisted, cross-session memory)
  lastModel: string | null
  lastThinking: string | null
  rememberModel: (model: string) => void
  rememberThinking: (level: string) => void

  // Extension config routing (B-layer: adapter config page requests)
  pendingExtensionConfig: string | null
  requestExtensionConfig: (pluginName: string | null) => void

  // Model picker (A-layer: /model opens panel, not silent cycle)
  modelPickerOpen: boolean
  setModelPickerOpen: (open: boolean) => void

  // Thinking picker
  thinkingPickerOpen: boolean
  setThinkingPickerOpen: (open: boolean) => void

  /** 运行中已入队、尚未送达的消息（来自 queue_update，对齐 TUI） */
  pendingSteering: string[]
  pendingFollowUp: string[]
  setPendingQueue: (steering: string[], followUp: string[]) => void
  clearPendingQueue: () => void

  // Event processing
  processEvent: (event: AppEvent) => void
}

let itemSeq = 0
function nextItemId(): string {
  return `item-${++itemSeq}`
}

/** pi 部分 provider 的 delta 是累积快照而非增量，需识别避免叠字 */
function mergeStreamChunk(current: string, delta: string): string {
  if (!delta) return current
  if (!current) return delta
  if (delta === current) return current
  if (current.endsWith(delta)) return current
  if (delta.startsWith(current)) return delta
  if (current.length >= delta.length && current.endsWith(delta.slice(-Math.min(8, delta.length)))) {
    const tail = delta.slice(-Math.min(8, delta.length))
    if (tail && current.endsWith(tail) && delta.length < current.length) return current
  }
  return current + delta
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
  currentWorkspace: null,
  recentProjects: [],
  ephemeralSandboxDraft: false,
  enterEphemeralSandboxDraft: () => {
    set({
      ephemeralSandboxDraft: true,
      currentWorkspace: null,
      currentSessionId: null,
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
    set({
      currentSessionId: id,
      rewindTreeNodes: [],
      rewindWorkerBound: false,
      rewindLoadingTree: true,
    })
  },
  loadHistoryItems: (items: TimelineItem[]) => {
    const { lastModel, lastThinking, runState } = get()
    set({
      timelineItems: items,
      streamingAssistantId: null,
      fileChanges: [],
      runState: {
        ...runState,
        status: 'idle',
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
    set((s) => ({
      timelineItems: [...items, ...s.timelineItems],
      historyLoadedCount: s.historyLoadedCount + items.length,
    })),
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
  appendDeltaToStreamingAssistant: (delta) =>
    set((s) => {
      const id = s.streamingAssistantId
      if (!id || !delta) return s
      return {
        timelineItems: s.timelineItems.map((i) => {
          if (i.id !== id) return i
          const next = mergeStreamChunk(i.text || '', delta)
          if (next === i.text) return i
          return { ...i, text: next }
        }),
      }
    }),
  appendThinkingDelta: (delta) =>
    set((s) => {
      const id = s.streamingAssistantId
      if (!id || !delta) return s
      return {
        timelineItems: s.timelineItems.map((i) => {
          if (i.id !== id) return i
          const next = mergeStreamChunk(i.thinkingText || '', delta)
          if (next === i.thinkingText) return i
          return { ...i, thinkingText: next }
        }),
      }
    }),
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
  setStreamingAssistantFinalText: (text) =>
    set((s) => {
      const id = s.streamingAssistantId
      if (!id) return { streamingAssistantId: null }
      return {
        streamingAssistantId: null,
        timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, text: text ?? i.text } : i)),
      }
    }),
  clearTimeline: () => set({ timelineItems: [], streamingAssistantId: null }),

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
  setActivePanel: (p) =>
    set((s) => ({
      activePanel: s.rightPanelPrefs[p] ? p : coerceActivePanel(p, s.rightPanelPrefs),
    })),
  rightPanelPrefs: defaultRightPanelPrefs(),
  applyRightPanelPrefs: (prefs) =>
    set((s) => ({
      rightPanelPrefs: prefs,
      activePanel: coerceActivePanel(s.activePanel, prefs),
    })),

  theme: 'system',
  setTheme: (t) => set({ theme: t }),
  sidebarWidth: 260,
  setSidebarWidth: (w) => set({ sidebarWidth: Math.min(Math.max(w, 200), 360) }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  rightPanelWidth: 288,
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.min(Math.max(w, 240), 420) }),
  rightPanelCollapsed: false,
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),

  pendingExtensionConfig: null,
  requestExtensionConfig: (pluginName) => set({ pendingExtensionConfig: pluginName }),

  modelPickerOpen: false,
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),

  thinkingPickerOpen: false,
  setThinkingPickerOpen: (open) => set({ thinkingPickerOpen: open }),

  pendingSteering: [],
  pendingFollowUp: [],
  setPendingQueue: (steering, followUp) => set({ pendingSteering: steering, pendingFollowUp: followUp }),
  clearPendingQueue: () => set({ pendingSteering: [], pendingFollowUp: [] }),

  processEvent: (event) => {
    const state = get()

    switch (event.type) {
      case 'message': {
        if (event.phase === 'start' && event.role === 'user') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'user-message',
            text: event.text,
            timestamp: event.timestamp,
            sessionEntryId: event.sessionEntryId,
          })
        } else if (event.phase === 'end' && event.role === 'user' && event.sessionEntryId) {
          const items = get().timelineItems
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].type === 'user-message' && !items[i].sessionEntryId) {
              state.updateTimelineItem(items[i].id, { sessionEntryId: event.sessionEntryId })
              break
            }
          }
        } else if (event.role === 'assistant') {
          if (event.phase === 'start') {
            const items = get().timelineItems
            const sid = get().streamingAssistantId
            const last = items[items.length - 1]
            if (last?.type === 'assistant-message' && sid === last.id) {
              break
            }
            const id = nextItemId()
            state.appendTimeline({
              id,
              type: 'assistant-message',
              text: '',
              thinkingText: '',
              runId: event.runId,
              timestamp: event.timestamp,
            })
            set({ streamingAssistantId: id })
          } else if (event.phase === 'delta' && event.text) {
            const kind = (event as { contentKind?: string }).contentKind
            if (kind === 'thinking') {
              state.appendThinkingDelta(event.text)
            } else {
              state.appendDeltaToStreamingAssistant(event.text)
            }
          } else if (event.phase === 'end') {
            const sid = get().streamingAssistantId
            if (event.text !== undefined) {
              state.setStreamingAssistantFinalText(event.text)
            } else {
              set({ streamingAssistantId: null })
            }
            if (sid && event.sessionEntryId) {
              state.updateTimelineItem(sid, { sessionEntryId: event.sessionEntryId })
            }
            state.pruneEmptyAssistantBubbles()
          }
        }
        break
      }
      case 'tool': {
        if (event.phase === 'start') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'tool-call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolPhase: 'start',
            toolArgs: (event as any).input,
            runId: event.runId,
            timestamp: event.timestamp,
          })
          state.setRunState({ activeTool: event.toolName })
        } else if (event.phase === 'update') {
          const items = get().timelineItems
          const lastTool = [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId)
            || [...items].reverse().find((i) => i.type === 'tool-call' && i.toolName === event.toolName && (i.toolPhase === 'start' || i.toolPhase === 'update'))
          const line = extractStatusLine(event.output)
          if (lastTool && line) {
            state.updateTimelineItem(lastTool.id, {
              toolPhase: 'update',
              toolStatusLine: line,
            })
          }
          // Update Run panel active tool status for any tool producing a status line.
          if (line) {
            state.setRunState({ activeTool: event.toolName, activeToolStatus: line })
          }
        } else if (event.phase === 'end') {
          const items = get().timelineItems
          const lastTool =
            [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId)
            || [...items].reverse().find(
              (i) =>
                i.type === 'tool-call'
                && i.toolName === event.toolName
                && (i.toolPhase === 'start' || i.toolPhase === 'update'),
            )
          let outText = ''
          const raw = event.output as any
          if (typeof raw === 'string') outText = raw
          else if (raw?.content && Array.isArray(raw.content)) {
            outText = raw.content.map((c: any) => c?.text || '').join('')
          } else if (raw != null) outText = JSON.stringify(raw, null, 2)
          if (lastTool) {
            state.updateTimelineItem(lastTool.id, {
              toolPhase: 'end',
              toolOutput: outText,
              toolDetails: (event as any).details,
              toolStatusLine: undefined,
              isError: event.isError,
            })
          }
          state.setRunState({
            toolCount: get().runState.toolCount + 1,
            activeTool: undefined,
            activeToolStatus: undefined,
            errorCount: get().runState.errorCount + (event.isError ? 1 : 0),
          })
        }
        break
      }
      case 'file': {
        state.addFileChange({
          path: event.path,
          source: event.source,
          changeType: event.changeType,
          turnId: event.turnId,
          runId: event.runId,
        })
        break
      }
      case 'run': {
        if (event.phase === 'started' || event.phase === 'running') {
          const runPatch: Record<string, unknown> = {
            status: 'running',
            activeRunId: event.runId,
            startTime: event.timestamp,
          }
          if (event.model != null && String(event.model).trim()) runPatch.model = event.model
          if (event.thinkingLevel != null && String(event.thinkingLevel).trim()) {
            runPatch.thinkingLevel = event.thinkingLevel
          }
          state.setRunState(runPatch)
        } else if (event.phase === 'idle') {
          const rs = get().runState
          const prevRun = rs.activeRunId
          const durationMs = rs.startTime ? Math.max(0, Date.now() - rs.startTime) : rs.lastRunDurationMs
          state.setRunState({
            status: 'idle',
            lastRunId: prevRun ?? rs.lastRunId,
            lastRunDurationMs: durationMs,
            activeRunId: undefined,
            activeTool: undefined,
            activeToolStatus: undefined,
          })
          state.clearPendingQueue()
          set({ streamingAssistantId: null })
          state.pruneEmptyAssistantBubbles()
        } else if (event.phase === 'failed') {
          state.setRunState({ status: 'failed' })
        } else if (event.phase === 'state') {
          const patch: Record<string, string | undefined> = {}
          if (event.model !== undefined) patch.model = event.model
          if (event.thinkingLevel !== undefined) patch.thinkingLevel = event.thinkingLevel
          state.setRunState(patch)
        }
        if (event.usage) {
          state.setRunState({ usage: event.usage })
        }
        if (event.toolStats) {
          state.setRunState({ toolCount: event.toolStats.total, errorCount: event.toolStats.failed })
        }
        break
      }
      case 'compaction': {
        if (event.phase === 'end') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'compaction',
            text: event.summary,
            timestamp: event.timestamp,
          })
        }
        break
      }
      case 'slash': {
        state.appendTimeline({
          id: nextItemId(),
          type: 'slash',
          slashCommand: event.command,
          slashStatus: event.status,
          text: event.text,
          isError: event.status === 'error',
          timestamp: event.timestamp,
        })
        break
      }
      case 'queue': {
        state.setPendingQueue(event.steering, event.followUp)
        break
      }
    }
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
