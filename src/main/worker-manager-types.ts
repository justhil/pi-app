import type { UtilityProcess } from 'electron'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'

export type WorkerInitResult = {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export type WorkerSlot = {
  cwd: string
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
  sdkFallback: boolean
  autoRestartEnabled: boolean
  stopping: boolean
}

export type WorkerAppEventForward = {
  event: AppEvent
  fromCwd: string
  agentTurnActive: boolean
}