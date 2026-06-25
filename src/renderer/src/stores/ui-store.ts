import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AppEvent } from '@shared/app-events'
import {
  coerceActivePanel,
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
  type RightPanelCatalogItem,
  type RightPanelPrefs,
} from '@shared/right-panels'
import { sanitizeRunStatePatch } from '@renderer/lib/format-run-display'
import { extractStatusFromOutput } from '@extension-compat/json-path'
import { resolveToolCardDef } from '@renderer/features/timeline/tool-card-registry'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import { alertTrace } from '@renderer/lib/alert-trace'
import {
  dedupeAdjacentUserMessages,
  normalizeTimelineMessageText,
  sanitizeHistoryTimeline,
} from '@renderer/lib/timeline-dedupe'
import { agentErrorKind, formatAgentErrorForTimeline } from '@renderer/lib/agent-error-text'

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

export interface TimelineItem {
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
  extensionUiSuspended?: boolean
  extensionUiRequestId?: string
  runId?: string
  isError?: boolean
  slashCommand?: string
  slashStatus?: 'dispatched' | 'ok' | 'error' | 'info'
  errorKind?: 'error' | 'aborted' | 'retry'
  /** Pi session tree entry id (for navigateTree / rewind) */
  sessionEntryId?: string
  attachments?: { path: string; name: string; kind: string }[]
  segments?: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; attachment: { path: string; name: string; kind: string } }
    | { type: 'clipboard-image'; path: string; name: string }
  >
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
  /** 项目内「新会话」占位，首条消息前不调用 session.new */
  pendingNewSessionPlaceholder: boolean
  enterEphemeralSandboxDraft: () => void
  clearEphemeralSandboxDraft: () => void
  enterPendingNewSessionPlaceholder: (opts?: { keepTimeline?: boolean }) => void
  clearPendingNewSessionPlaceholder: () => void

  // Sessions
  sessions: SessionItem[]
  currentSessionId: string | null
  setSessions: (s: SessionItem[]) => void
  setCurrentSession: (id: string | null) => void
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
  activePanel: string
  setActivePanel: (p: string) => void
  rightPanelCatalog: RightPanelCatalogItem[]
  rightPanelPrefs: RightPanelPrefs
  rightPanelOrder: string[]
  applyRightPanelRuntime: (catalog: RightPanelCatalogItem[], prefs: RightPanelPrefs, order?: string[]) => void

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

  /** 已发送、尚未被 Worker 事件确认的乐观用户文案 */
  optimisticPendingUserText: string | null
  /** Agent 启动/首 token 前的等待态 */
  agentTurnBootstrapping: boolean
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

type StreamFlushKind = 'text' | 'thinking'
let streamFlushScheduled = false
const streamPending = new Map<string, { text: string; thinking: string }>()

function scheduleStreamFlush(set: (fn: (s: UIState) => Partial<UIState> | UIState) => void, get: () => UIState) {
  if (streamFlushScheduled) return
  streamFlushScheduled = true
  requestAnimationFrame(() => flushStreamPendingSync(get, set))
}

function flushStreamPendingSync(
  get: () => UIState,
  set: (fn: (s: UIState) => Partial<UIState> | UIState) => void,
) {
  streamFlushScheduled = false
  const sid = get().streamingAssistantId
  if (!sid) {
    streamPending.clear()
    return
  }
  const pending = streamPending.get(sid)
  if (!pending || (!pending.text && !pending.thinking)) return
  const textDelta = pending.text
  const thinkDelta = pending.thinking
  pending.text = ''
  pending.thinking = ''
  set((s) => {
    if (s.streamingAssistantId !== sid) return s
    let items = s.timelineItems
    let changed = false
    if (textDelta) {
      items = items.map((i) => {
        if (i.id !== sid) return i
        const next = mergeStreamChunk(i.text || '', textDelta)
        if (next === i.text) return i
        changed = true
        return { ...i, text: next }
      })
    }
    if (thinkDelta) {
      items = items.map((i) => {
        if (i.id !== sid) return i
        const next = mergeStreamChunk(i.thinkingText || '', thinkDelta)
        if (next === i.thinkingText) return i
        changed = true
        return { ...i, thinkingText: next }
      })
    }
    if (!changed) return s
    return { timelineItems: items }
  })
}

function queueStreamDelta(
  get: () => UIState,
  set: (fn: (s: UIState) => Partial<UIState> | UIState) => void,
  kind: StreamFlushKind,
  delta: string,
) {
  const sid = get().streamingAssistantId
  if (!sid || !delta) return
  let row = streamPending.get(sid)
  if (!row) {
    row = { text: '', thinking: '' }
    streamPending.set(sid, row)
  }
  if (kind === 'text') row.text = mergeStreamChunk(row.text, delta)
  else row.thinking = mergeStreamChunk(row.thinking, delta)
  scheduleStreamFlush(set, get)
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
    const { lastModel, lastThinking, runState, streamingAssistantId } = get()
    const keepRunning = runState.status === 'running' || streamingAssistantId != null
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
      streamPending.delete(id)
      return {
        streamingAssistantId: null,
        timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, text: i.text && i.text.trim() ? i.text : (text ?? i.text) } : i)),
      }
    })
  },
  clearTimeline: () => {
    streamPending.clear()
    streamFlushScheduled = false
    set({ timelineItems: [], streamingAssistantId: null, optimisticPendingUserText: null, agentTurnBootstrapping: false })
  },

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
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.min(Math.max(w, 240), 420) }),
  rightPanelCollapsed: false,
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),

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
  setPendingQueue: (steering, followUp) => set({ pendingSteering: steering, pendingFollowUp: followUp }),
  clearPendingQueue: () => set({ pendingSteering: [], pendingFollowUp: [] }),

  processEvent: (event) => {
    const state = get()

    switch (event.type) {
      case 'message': {
        if (event.phase === 'start' && event.role === 'user') {
          if (get().runState.status !== 'running') {
            state.setRunState({ status: 'running', startTime: event.timestamp })
          }
          const opt = get().optimisticPendingUserText
          const incoming = normalizeTimelineMessageText(event.text)
          if (opt || incoming) {
            const items = get().timelineItems
            const lastUser = [...items].reverse().find((i) => i.type === 'user-message')
            const lastNorm = lastUser ? normalizeTimelineMessageText(lastUser.text) : ''
            const optNorm = opt ? normalizeTimelineMessageText(opt) : ''
            const matchesOpt =
              !!lastUser &&
              (lastUser.id.startsWith('opt-user-') || (optNorm && lastNorm === optNorm))
            const matchesIncoming = !!lastUser && incoming && lastNorm === incoming
            if (matchesOpt || matchesIncoming) {
              if (event.text?.trim()) {
                state.updateTimelineItem(lastUser!.id, {
                  text: event.text,
                  // 确认事件 payload 含 @path，切换为行内解析渲染；废弃乐观 segments
                  segments: undefined,
                  ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {}),
                })
              } else if (event.sessionEntryId) {
                state.updateTimelineItem(lastUser!.id, { sessionEntryId: event.sessionEntryId })
              }
              set({ optimisticPendingUserText: null })
              break
            }
            if (opt) set({ optimisticPendingUserText: null })
          }
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
              set({ optimisticPendingUserText: null })
              break
            }
          }
        } else if (event.role === 'assistant') {
          if (event.phase === 'start') {
            set({ agentTurnBootstrapping: false })
            const items = get().timelineItems
            const sid = get().streamingAssistantId
            const last = items[items.length - 1]
            if (last?.type === 'assistant-message' && sid === last.id) {
              break
            }
            const emptyOpt = [...items].reverse().find(
              (i) => i.type === 'assistant-message' && i.id.startsWith('opt-asst-') && !i.text?.trim(),
            )
            if (emptyOpt) {
              set({ streamingAssistantId: emptyOpt.id })
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
            set({ agentTurnBootstrapping: false })
            const kind = (event as { contentKind?: string }).contentKind
            // R7: tool 介入会定稿当前流式气泡（见 tool start），后续 delta 续接新气泡，
            // 避免「工具行被后续流式文字盖到下方」的错位
            if (!get().streamingAssistantId) {
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
            }
            if (kind === 'thinking') {
              state.appendThinkingDelta(event.text)
            } else {
              state.appendDeltaToStreamingAssistant(event.text)
            }
          } else if (event.phase === 'end') {
            const sid = get().streamingAssistantId
            const hasFinalText = event.text !== undefined && String(event.text).trim().length > 0
            if (hasFinalText) {
              state.setStreamingAssistantFinalText(event.text ?? '')
            } else if (!get().agentTurnBootstrapping && !get().optimisticPendingUserText) {
              set({ streamingAssistantId: null })
            }
            if (sid && event.sessionEntryId) {
              state.updateTimelineItem(sid, { sessionEntryId: event.sessionEntryId })
            }
            if (!get().agentTurnBootstrapping) {
              state.pruneEmptyAssistantBubbles()
            }
          }
        }
        break
      }
      case 'tool': {
        if (event.phase === 'start') {
          // R7: tool 介入时定稿当前流式气泡（清空 sid），后续 delta 续接新气泡，
          // 使工具行落在「已输出文字」与「后续文字」之间，而非被后续文字盖到下方
          if (get().streamingAssistantId) set({ streamingAssistantId: null })
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
          const line = extractStatusFromOutput(event.output, resolveToolCardDef(event.toolName)?.statusField)
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
          alertTrace('run event idle', {
            runId: event.runId,
            statusBefore: get().runState.status,
            startTime: get().runState.startTime,
          })
          const pendingOutboundTurn =
            get().optimisticPendingUserText != null ||
            get().agentTurnBootstrapping ||
            get().timelineItems.some(
              (i) =>
                i.type === 'assistant-message' &&
                i.id.startsWith('opt-asst-') &&
                !i.text?.trim() &&
                !i.thinkingText?.trim(),
            )
          if (pendingOutboundTurn) {
            break
          }
          set({ optimisticPendingUserText: null, agentTurnBootstrapping: false })
          const rs = get().runState
          const wasActive = rs.status === 'running' || rs.status === 'failed'
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
          if (wasActive && rs.startTime && durationMs != null && durationMs >= 800) {
            const sec = Math.round(durationMs / 1000)
            alertTrace('run_idle alert fired', { durationMs, sec })
            void signalDesktopAlert('run_idle', {
              title: 'pi Desktop · 运行结束',
              body: sec != null && sec > 0 ? `Agent 已空闲（约 ${sec} 秒）` : 'Agent 已空闲，可继续输入',
            })
          }
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
        if (event.phase === 'start') {
          void Promise.all([
            import('@renderer/lib/extension-ui-channel'),
            import('@renderer/stores/extension-ui-store'),
          ]).then(([ch, st]) => {
            ch.clearExtensionDialogDedupe()
            st.useExtensionUIStore.getState().clearAfterRespond()
          })
        } else if (event.phase === 'end') {
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
      case 'agent_error': {
        set({ optimisticPendingUserText: null, agentTurnBootstrapping: false, streamingAssistantId: null })
        state.pruneEmptyAssistantBubbles()
        const raw = event.text || '未知错误'
        const kind = event.kind || agentErrorKind(raw)
        const formatted = formatAgentErrorForTimeline(raw)
        const items = get().timelineItems
        const last = items[items.length - 1]
        if (last?.type === 'error' && last.text === formatted) break
        state.appendTimeline({
          id: nextItemId(),
          type: 'error',
          text: formatted,
          errorKind: kind,
          timestamp: event.timestamp,
        })
        state.setRunState({ status: kind === 'aborted' ? 'idle' : 'failed' })
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
