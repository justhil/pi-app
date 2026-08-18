/** Worker ↔ Main JSON-RPC style payloads (loosely typed JSON). */

import type { ModelAuthProjection } from './model-auth-projection'
import type { SkillCatalogResponse } from './skill-catalog'
import type { PiSessionMessage } from './worker-message'
import type { SessionContextPreview } from './session-context-preview'

export type WorkerCommandInfo = {
  name: string
  description?: string
  [key: string]: unknown
}

export type WorkerSkillInfo = SkillCatalogResponse

export type WorkerPromptTemplate = {
  name: string
  path?: string
  description?: string
  [key: string]: unknown
}

export type WorkerState = Record<string, unknown>

export type WorkerContextPreview = SessionContextPreview | null

export type WorkerModelRow = {
  id?: string
  provider?: string
  name?: string
  contextWindow?: number
  maxOutput?: number
  maxTokens?: number
  available?: boolean
  managedBy?: 'active-sdk'
  auth?: ModelAuthProjection
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

/** pi SDK 内置斜杠命令条目（BUILTIN_SLASH_COMMANDS 的投影，跟随生效 SDK 版本）。 */
export type WorkerBuiltinSlashCommand = {
  name: string
  description: string
  argumentHint?: string
}

export type WorkerMessagesPage = {
  items: PiSessionMessage[]
  sourceCount: number
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}

export type WorkerRequestPayload = Record<string, unknown>

export type WorkerResponsePayload = Record<string, unknown>
