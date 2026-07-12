import { useMemo } from 'react'
import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import {
  composerTurnActive,
  type WorkerLiveSnapshot,
} from '@renderer/lib/session-worker-sync'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

export type SessionChromePhase =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'tool'
  | 'waiting_ui'
  | 'retrying'
  | 'compacting'
  | 'stopping'
  | 'failed'

export type SessionChromeView = {
  sessionFile: string | null
  phase: SessionChromePhase
  canStop: boolean
  showSpinner: boolean
  statusLabelKey: string
  activeToolName?: string
  runId?: string
  /** Only set when `now` is passed (tests); omitted in production to keep selector stable. */
  updatedAt?: number
}

export type SessionChromeInput = {
  historySessionFile: string | null
  workerLiveSnapshot: WorkerLiveSnapshot
  runState: {
    status: string
    activeTool?: string
    activeRunId?: string
  }
  streamingAssistantId: string | null
  optimisticPendingUserText: string | null
  sessionRuntimeRunning?: Record<string, boolean> | null
  agentTurnBootstrapping?: boolean
  /** Extension dialog open (display-only waiting_ui). */
  extensionDialogOpen?: boolean
  /** Compaction in progress for the viewed session. */
  compacting?: boolean
  /** willRetry / retry-class agent error while still busy. */
  retrying?: boolean
  /** Override clock for tests (also stamps `updatedAt`). */
  now?: number
  /** Override abort-hold probe for tests. */
  abortHoldActive?: boolean
}

const PHASE_STATUS_KEY: Record<SessionChromePhase, string> = {
  idle: 'common:app.status.idle',
  starting: 'run:status.running',
  streaming: 'run:status.running',
  tool: 'run:status.toolRunning',
  waiting_ui: 'run:status.waitingUi',
  retrying: 'run:status.retrying',
  compacting: 'run:compacting',
  stopping: 'run:status.stopping',
  failed: 'common:app.status.failed',
}

function chromeStamp(now?: number): Pick<SessionChromeView, 'updatedAt'> {
  return now === undefined ? {} : { updatedAt: now }
}

/**
 * Single-source session chrome projection (Stop / spinner / status label).
 * Display-only: no new worker protocols. Built on composerTurnActive + abort hold + extension dialog.
 *
 * Pure: same inputs → same output (except optional `now` stamp). Safe for React memo / useMemo.
 */
export function selectSessionChrome(input: SessionChromeInput): SessionChromeView {
  const stamp = chromeStamp(input.now)
  const sessionFile = input.historySessionFile
    ? normalizeSessionFileKey(input.historySessionFile) || input.historySessionFile
    : null
  const abortHold =
    input.abortHoldActive !== undefined ? input.abortHoldActive : isAbortUiHoldActive()

  const turnActive = composerTurnActive({
    historySessionFile: input.historySessionFile,
    workerLiveSnapshot: input.workerLiveSnapshot,
    runState: input.runState,
    streamingAssistantId: input.streamingAssistantId,
    optimisticPendingUserText: input.optimisticPendingUserText,
    sessionRuntimeRunning: input.sessionRuntimeRunning,
    agentTurnBootstrapping: input.agentTurnBootstrapping,
  })

  // Abort hold always projects stopping (even after local markers cleared by applyComposerAbortUi).
  if (abortHold) {
    return {
      sessionFile,
      phase: 'stopping',
      canStop: false,
      showSpinner: true,
      statusLabelKey: PHASE_STATUS_KEY.stopping,
      activeToolName: input.runState.activeTool,
      runId: input.runState.activeRunId,
      ...stamp,
    }
  }

  if (!turnActive) {
    if (input.runState.status === 'failed') {
      return {
        sessionFile,
        phase: 'failed',
        canStop: false,
        showSpinner: false,
        statusLabelKey: PHASE_STATUS_KEY.failed,
        runId: input.runState.activeRunId,
        ...stamp,
      }
    }
    return {
      sessionFile,
      phase: 'idle',
      canStop: false,
      showSpinner: false,
      statusLabelKey: PHASE_STATUS_KEY.idle,
      runId: input.runState.activeRunId,
      ...stamp,
    }
  }

  let phase: SessionChromePhase = 'streaming'

  if (input.compacting) {
    phase = 'compacting'
  } else if (input.retrying) {
    phase = 'retrying'
  } else if (input.extensionDialogOpen) {
    phase = 'waiting_ui'
  } else if (input.runState.activeTool) {
    phase = 'tool'
  } else if (
    input.agentTurnBootstrapping === true ||
    (input.optimisticPendingUserText != null && input.streamingAssistantId == null)
  ) {
    phase = 'starting'
  } else if (input.streamingAssistantId != null) {
    phase = 'streaming'
  } else {
    phase = 'starting'
  }

  return {
    sessionFile,
    phase,
    canStop: true,
    showSpinner: true,
    statusLabelKey: PHASE_STATUS_KEY[phase],
    activeToolName: input.runState.activeTool,
    runId: input.runState.activeRunId,
    ...stamp,
  }
}

/** Thin store → chrome adapter for pure tests (not for useUIStore selectors). */
export function selectSessionChromeFromUiState(state: {
  historySessionFile: string | null
  workerLiveSnapshot: WorkerLiveSnapshot
  runState: SessionChromeInput['runState']
  streamingAssistantId: string | null
  optimisticPendingUserText: string | null
  sessionRuntimeRunning?: Record<string, boolean> | null
  agentTurnBootstrapping?: boolean
  extensionDialogOpen?: boolean
  compacting?: boolean
  retrying?: boolean
}): SessionChromeView {
  return selectSessionChrome(state)
}

/**
 * React hook: subscribe to primitive store fields, memoize chrome view.
 * Never pass selectSessionChrome directly into useUIStore — it returns a new object every time
 * (and previously stamped Date.now()), which causes Maximum update depth exceeded.
 */
export function useSessionChrome(options?: {
  extensionDialogOpen?: boolean
  compacting?: boolean
  retrying?: boolean
}): SessionChromeView {
  const extensionDialogOpen = options?.extensionDialogOpen === true
  const compacting = options?.compacting === true
  const retrying = options?.retrying === true

  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const workerLiveSnapshot = useUIStore((s) => s.workerLiveSnapshot)
  const runStatus = useUIStore((s) => s.runState.status)
  const activeTool = useUIStore((s) => s.runState.activeTool)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const streamingAssistantId = useUIStore((s) => s.streamingAssistantId)
  const optimisticPendingUserText = useUIStore((s) => s.optimisticPendingUserText)
  const sessionRuntimeRunning = useUIStore((s) => s.sessionRuntimeRunning)
  const agentTurnBootstrapping = useUIStore((s) => s.agentTurnBootstrapping)

  return useMemo(
    () =>
      selectSessionChrome({
        historySessionFile,
        workerLiveSnapshot,
        runState: {
          status: runStatus,
          activeTool,
          activeRunId,
        },
        streamingAssistantId,
        optimisticPendingUserText,
        sessionRuntimeRunning,
        agentTurnBootstrapping,
        extensionDialogOpen,
        compacting,
        retrying,
      }),
    [
      historySessionFile,
      workerLiveSnapshot,
      runStatus,
      activeTool,
      activeRunId,
      streamingAssistantId,
      optimisticPendingUserText,
      sessionRuntimeRunning,
      agentTurnBootstrapping,
      extensionDialogOpen,
      compacting,
      retrying,
    ],
  )
}
