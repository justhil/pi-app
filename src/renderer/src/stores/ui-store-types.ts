import type { RightPanelCatalogItem, RightPanelPrefs } from '@shared/right-panels'
import type { WorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'

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