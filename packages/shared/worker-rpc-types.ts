/** Worker ↔ Main JSON-RPC style payloads (loosely typed JSON). */

import type { PiSessionMessage } from './worker-message'

export type WorkerCommandInfo = {
  name: string
  description?: string
  [key: string]: unknown
}

export type WorkerSkillInfo = {
  name: string
  path?: string
  description?: string
  source?: string
}

export type WorkerPromptTemplate = {
  name: string
  path?: string
  description?: string
  [key: string]: unknown
}

export type WorkerState = Record<string, unknown>

export type WorkerContextPreview = Record<string, unknown> | null

export type WorkerModelRow = {
  id?: string
  provider?: string
  name?: string
  [key: string]: unknown
}

export type WorkerSessionOnDisk = {
  sessionFile?: string
  title?: string
  updatedAt?: number
  [key: string]: unknown
}

export type WorkerSessionTreeNode = {
  id: string
  label?: string
  children?: WorkerSessionTreeNode[]
  [key: string]: unknown
}

export type WorkerCompletionItem = Record<string, unknown>

export type WorkerMessagesPage = {
  items: PiSessionMessage[]
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}

export type WorkerRequestPayload = Record<string, unknown>

export type WorkerResponsePayload = Record<string, unknown>