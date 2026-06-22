// IPC Contract - Complete typed method signatures for Renderer/Main/Worker

import type { AppEvent } from './app-events'
import type { DiffResult } from './diff-model'
import type { CompatibilityLevel } from './extension-types'

// ── Workspace ──
export interface WorkspaceOpenRequest { path: string }
export interface WorkspaceOpenResponse { workspaceId: string; path: string; name: string }
export interface WorkspaceSwitchRequest { workspaceId: string }
export interface WorkspaceSwitchResponse { workspaceId: string; path: string; name: string }

// ── Session ──
export interface SessionInfo {
  sessionId: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  modelId: string
  status: 'idle' | 'busy' | 'error'
}
export interface SessionListRequest { workspaceId?: string }
export interface SessionListResponse { sessions: SessionInfo[] }
export interface SessionOpenRequest { sessionId: string; sessionFile?: string }
export interface SessionOpenResponse { session: SessionInfo }
export interface SessionNewRequest { workspaceId: string; title?: string; modelId?: string }
export interface SessionNewResponse { session: SessionInfo }
export interface SessionForkRequest { sessionId: string; fromMessageId?: string; title?: string }
export interface SessionForkResponse { session: SessionInfo }
export interface SessionCloneRequest { sessionId: string; title?: string }
export interface SessionCloneResponse { session: SessionInfo }
export interface SessionRenameRequest { sessionId: string; title: string }
export interface SessionRenameResponse { session: SessionInfo }
export interface SessionCompactRequest { sessionId: string }
export interface SessionCompactResponse { sessionId: string; compacted: boolean; tokensSaved: number }
export interface SessionExportRequest { sessionId: string; format: 'json' | 'markdown' | 'html' }
export interface SessionExportResponse { content: string; format: string; filename: string }

// ── Prompt ──
export interface PromptSendRequest { sessionId: string; text: string }
export interface PromptSendResponse { messageId: string }
export interface ImageInput { name: string; mimeType: string; data: string }
export interface PromptSendWithImagesRequest { sessionId: string; text: string; images: ImageInput[] }
export interface PromptSendWithImagesResponse { messageId: string }
export interface PromptSteerRequest { sessionId: string; text: string }
export interface PromptSteerResponse { steered: boolean }
export interface PromptFollowUpRequest { sessionId: string; text: string }
export interface PromptFollowUpResponse { messageId: string }
export interface PromptAbortRequest { sessionId: string }
export interface PromptAbortResponse { aborted: boolean }

// ── Model ──
export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
}
export interface ModelListRequest { workspaceId?: string }
export interface ModelListResponse { models: ModelInfo[] }
export interface ModelSetRequest { sessionId: string; modelId: string }
export interface ModelSetResponse { modelId: string }
export interface ModelCycleRequest { sessionId: string; direction?: 'next' | 'prev' }
export interface ModelCycleResponse { modelId: string; thinkingLevel: string }

// ── ThinkingLevel ──
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export interface ThinkingLevelSetRequest { sessionId: string; level: ThinkingLevel }
export interface ThinkingLevelSetResponse { level: string }

// ── Commands ──
export interface CommandInfo {
  id: string
  name: string
  description: string
  category: 'skill' | 'prompt' | 'extension' | 'builtin'
}
export interface CommandsListRequest { sessionId?: string }
export interface CommandsListResponse { commands: CommandInfo[] }

// ── Review ──
export interface ReviewGetDiffRequest {
  sessionId: string
  scope: 'turn' | 'session' | 'git'
  turnId?: string
}
export interface ReviewGetDiffResponse { diff: DiffResult }

// ── Extensions ──
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  compatibility: CompatibilityLevel
  source: 'global' | 'project' | 'package'
  registeredTools: string[]
  registeredCommands: string[]
  loadError?: string
}
export interface ExtensionsListRequest {}
export interface ExtensionsListResponse { extensions: ExtensionInfo[] }
export interface ExtensionsSetOverrideRequest { extensionId: string; enabled: boolean }
export interface ExtensionsSetOverrideResponse { extensionId: string; enabled: boolean }

// ── Registry ──
export interface RegistryRefreshRequest { force?: boolean }
export interface RegistryRefreshResponse { refreshed: boolean; count: number; version?: string }

// ── Settings ──
export interface SettingsGetRequest { key?: string }
export interface SettingsGetResponse { settings: Record<string, unknown> }
export interface SettingsSetRequest { key: string; value: unknown }
export interface SettingsSetResponse { key: string; value: unknown }

// ── App update (GitHub Releases) ──
export interface AppCheckUpdateRequest {}
export interface AppCheckUpdateResponse {
  ok: boolean
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string
  error?: string
}
export interface AppOpenReleaseRequest { url?: string }
export interface AppOpenReleaseResponse { ok: boolean }

// ── Events ──
export interface EventsSubscribeRequest { channels?: string[] }
export interface EventsSubscribeResponse { subscriptionId: string }

// ── IPC Method Map ──
export interface IpcMethodMap {
  'workspace.open': { request: WorkspaceOpenRequest; response: WorkspaceOpenResponse }
  'workspace.switch': { request: WorkspaceSwitchRequest; response: WorkspaceSwitchResponse }
  'session.list': { request: SessionListRequest; response: SessionListResponse }
  'session.open': { request: SessionOpenRequest; response: SessionOpenResponse }
  'session.new': { request: SessionNewRequest; response: SessionNewResponse }
  'session.fork': { request: SessionForkRequest; response: SessionForkResponse }
  'session.clone': { request: SessionCloneRequest; response: SessionCloneResponse }
  'session.rename': { request: SessionRenameRequest; response: SessionRenameResponse }
  'session.compact': { request: SessionCompactRequest; response: SessionCompactResponse }
  'session.export': { request: SessionExportRequest; response: SessionExportResponse }
  'prompt.send': { request: PromptSendRequest; response: PromptSendResponse }
  'prompt.sendWithImages': { request: PromptSendWithImagesRequest; response: PromptSendWithImagesResponse }
  'prompt.steer': { request: PromptSteerRequest; response: PromptSteerResponse }
  'prompt.followUp': { request: PromptFollowUpRequest; response: PromptFollowUpResponse }
  'prompt.abort': { request: PromptAbortRequest; response: PromptAbortResponse }
  'model.list': { request: ModelListRequest; response: ModelListResponse }
  'model.set': { request: ModelSetRequest; response: ModelSetResponse }
  'model.cycle': { request: ModelCycleRequest; response: ModelCycleResponse }
  'thinkingLevel.set': { request: ThinkingLevelSetRequest; response: ThinkingLevelSetResponse }
  'commands.list': { request: CommandsListRequest; response: CommandsListResponse }
  'review.getDiff': { request: ReviewGetDiffRequest; response: ReviewGetDiffResponse }
  'extensions.list': { request: ExtensionsListRequest; response: ExtensionsListResponse }
  'extensions.setOverride': { request: ExtensionsSetOverrideRequest; response: ExtensionsSetOverrideResponse }
  'registry.refresh': { request: RegistryRefreshRequest; response: RegistryRefreshResponse }
  'settings.get': { request: SettingsGetRequest; response: SettingsGetResponse }
  'settings.set': { request: SettingsSetRequest; response: SettingsSetResponse }
  'app.checkUpdate': { request: AppCheckUpdateRequest; response: AppCheckUpdateResponse }
  'app.openRelease': { request: AppOpenReleaseRequest; response: AppOpenReleaseResponse }
  'events.subscribe': { request: EventsSubscribeRequest; response: EventsSubscribeResponse; stream: AppEvent }
}

// ── Type helpers ──
export type IpcMethodName = keyof IpcMethodMap
export type IpcRequest<M extends IpcMethodName> = IpcMethodMap[M]['request']
export type IpcResponse<M extends IpcMethodName> = IpcMethodMap[M]['response']

export function ipcChannel<M extends IpcMethodName>(method: M): string {
  return `ipc:${method}`
}

export interface IpcInvoker {
  invoke<M extends IpcMethodName>(method: M, request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export interface IpcHandler<M extends IpcMethodName> {
  (request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export const EVENTS_CHANNEL = 'ipc:events'
