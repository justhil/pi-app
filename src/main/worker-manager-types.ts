import type { UtilityProcess } from 'electron'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'

export type WorkerInitResult = {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export type WorkerSlot = {
  /** Pool map key: sessionFile abs path or `ws:${cwd}` */
  poolKey: string
  cwd: string
  /** Bound session file when known; null for workspace-only slots */
  sessionFile: string | null
  worker: UtilityProcess
  pendingRequests: Map<
    string,
    { resolve: (v: WorkerResponsePayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >
  requestCounter: number
  initResolver: ((r: WorkerInitResult) => void) | null
  initRejecter: ((e: Error) => void) | null
  initPromise: Promise<WorkerInitResult> | null
  agentTurnActive: boolean
  /** Last time turn became idle (ms); used for idle TTL eviction */
  lastIdleAt: number
  /** Last time this slot was foreground (ms) */
  lastForegroundAt: number
  sdkFallback: boolean
  autoRestartEnabled: boolean
  stopping: boolean
}

export type WorkerAppEventForward = {
  event: AppEvent
  fromCwd: string
  fromPoolKey: string
  sessionFile: string | null
  agentTurnActive: boolean
}
