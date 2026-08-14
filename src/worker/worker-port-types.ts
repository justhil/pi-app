/** Messages from Main → Worker utilityProcess. */
export type WorkerIncomingMessage = {
  type?: string
  requestId?: string
  cwd?: string
  sdkPath?: string | null
  /** 回合文件最终净 diff 的单文件快照上限（字节；0 = 关闭） */
  turnDiffSnapshotMaxBytes?: number
  text?: string
  options?: unknown
  sessionFile?: string
  offset?: number
  limit?: number
  targetId?: string
  summarize?: boolean
  customInstructions?: string
  replaceInstructions?: string
  label?: string
  provider?: string
  modelId?: string
  level?: string
  patch?: Record<string, unknown>
  commandName?: string
  argumentPrefix?: string
  [key: string]: unknown
}

export type WorkerCommandRow = {
  id: string
  name: string
  description: string
  category: string
  source?: unknown
}

export type WorkerModelRow = {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
}