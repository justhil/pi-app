import type { AppEvent } from '@shared/app-events'
import type { RightPanelCatalogItem, RightPanelPrefs } from '@shared/right-panels'
import type { WorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'

export interface SessionItem {
  sessionId: string
  sessionFile?: string
  title: string
  updatedAt: number
  messageCount?: number
  modelId: string
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
  toolDetails?: unknown
  toolArgs?: unknown
  toolStatusLine?: string
  extensionUiSuspended?: boolean
  extensionUiRequestId?: string
  runId?: string
  isError?: boolean
  slashCommand?: string
  slashStatus?: 'dispatched' | 'ok' | 'error' | 'info'
  errorKind?: 'error' | 'aborted' | 'retry'
  sessionEntryId?: string
  attachments?: { path: string; name: string; kind: string }[]
  segments?: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; attachment: { path: string; name: string; kind: string } }
    | { type: 'clipboard-image'; path: string; name: string }
  >
  timestamp: number
}

export interface FileChange {
  path: string
  source: string
  changeType: string
  turnId?: string
  runId?: string
}

export interface RunState {
  status: 'idle' | 'running' | 'failed'
  activeRunId?: string
  lastRunId?: string
  model?: string
  thinkingLevel?: string
  startTime?: number
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

/** Slice of UIState used by AppEvent application */
export interface AppEventStoreSlice {
  currentSessionId: string | null
  workerLiveSnapshot: WorkerLiveSnapshot
  timelineItems: TimelineItem[]
  streamingAssistantId: string | null
  runState: RunState
  fileChanges: FileChange[]
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
  ignoreQueueSyncUntil: number
  pendingSteering: string[]
  pendingFollowUp: string[]
  rightPanelCatalog: RightPanelCatalogItem[]
  rightPanelPrefs: RightPanelPrefs
}

export interface UIState {
  currentWorkspace: string | null
  recentProjects: string[]
  setWorkspace: (path: string | null) => void
  ephemeralSandboxDraft: boolean
  pendingNewSessionPlaceholder: boolean
  enterEphemeralSandboxDraft: () => void
  clearEphemeralSandboxDraft: () => void
  enterPendingNewSessionPlaceholder: (opts?: { keepTimeline?: boolean }) => void
  clearPendingNewSessionPlaceholder: () => void
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
  timelineItems: TimelineItem[]
  streamingAssistantId: string | null
  appendTimeline: (item: TimelineItem) => void
  updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => void
  appendDeltaToStreamingAssistant: (delta: string) => void
  appendThinkingDelta: (delta: string) => void
  setStreamingAssistantFinalText: (text: string) => void
  pruneEmptyAssistantBubbles: () => void
  clearTimeline: () => void
  runState: RunState
  setRunState: (patch: Partial<RunState>) => void
  workerLiveSnapshot: WorkerLiveSnapshot
  setWorkerLiveSnapshot: (snap: WorkerLiveSnapshot) => void
  fileChanges: FileChange[]
  addFileChange: (fc: FileChange) => void
  clearFileChanges: () => void
  composerPrefill: string | null
  setComposerPrefill: (text: string | null) => void
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
  filesPreviewChatExpand: boolean
  lastModel: string | null
  lastThinking: string | null
  rememberModel: (model: string) => void
  rememberThinking: (level: string) => void
  pendingExtensionConfig: string | null
  requestExtensionConfig: (pluginName: string | null) => void
  modelPickerOpen: boolean
  setModelPickerOpen: (open: boolean) => void
  thinkingPickerOpen: boolean
  setThinkingPickerOpen: (open: boolean) => void
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
  pendingSteering: string[]
  pendingFollowUp: string[]
  setPendingQueue: (steering: string[], followUp: string[]) => void
  clearPendingQueue: () => void
  ignoreQueueSyncUntil: number
  markAbortQueueIgnore: (ms?: number) => void
  processEvent: (event: AppEvent) => void
}