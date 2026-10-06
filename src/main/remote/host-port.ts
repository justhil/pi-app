import type { TreeRow } from './branches'
import type { AppEvent } from '@shared/app-events'
import type { CapabilityInfo } from '@shared/capabilities'
import type { CacheWarming, CommandInfo, ContextStats, FileEntry, UiRequest, UiResponse } from '@shared/remote'
import type { ToolCardDef } from '../../extension-compat/adapter-schema'

/**
 * Everything the remote gateway needs from the desktop. The gateway never touches Electron,
 * workerManager or config directly — only this port — so it runs under tests with a fake and
 * could later run headless. The Electron implementation lives in `src/main/remote-host-electron.ts`.
 *
 * Hard rule for implementations: nothing here may change the desktop's foreground session,
 * pending bind or current workspace (no `session.open` / `setPendingBind` / `workspace.switch`).
 */

export type HostSessionRow = {
  sessionFile: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  firstMessage?: string
}

/** Timeline row as produced by the worker / preview process (see src/worker/worker-timeline.ts). */
export type HostTimelineItem = {
  id: string
  type: string
  text?: string
  thinkingText?: string
  toolName?: string
  toolCallId?: string
  toolArgs?: unknown
  toolOutput?: string
  toolDetails?: unknown
  isError?: boolean
  sessionEntryId?: string
  timestamp?: number
  incomplete?: boolean
  stopReason?: string
}

export type HostSessionHistory = {
  items: HostTimelineItem[]
  model?: string
  thinking?: string
}

export type HostLiveState = {
  running: boolean
  model?: string
  thinking?: string
  availableThinking?: string[]
}

export type HostModelList = {
  models: Array<{ id: string; name?: string; provider?: string; group?: 'custom' | 'apiKey' | 'login' }>
  current?: string
  thinking?: string
  availableThinking: string[]
}

export type SendMode = 'prompt' | 'steer' | 'followUp'

export interface RemoteHostPort {
  hostName(): string
  appVersion(): string

  /** Projects the desktop trusts (recent projects). The gateway intersects them with its whitelist. */
  trustedProjects(): string[]
  /** Display info for a project folder: temporary chats live in sandbox dirs named by a random id. */
  projectInfo?(path: string): { label?: string; temporary?: boolean }
  listSessions(projectId: string): Promise<HostSessionRow[]>
  /** Workspace the session belongs to (header cwd), or null when unknown / unreadable. */
  sessionProject(sessionFile: string): Promise<string | null>
  /** Disk-first history for an authorized session; never spawns a worker. */
  readHistory(projectId: string, sessionFile: string): Promise<HostSessionHistory>
  liveState(sessionFile: string): Promise<HostLiveState>

  /** `projectId` is the session's (whitelisted) workspace: the cwd fallback when its file has no header yet. */
  send(sessionFile: string, text: string, mode: SendMode, capabilities: string[], projectId: string): Promise<void>
  abort(sessionFile: string): Promise<void>
  /**
   * Move the session's leaf to just before the user entry `anchor` (desktop rewind). Binds the
   * session's own worker (cwd `projectId`) when it has none; returns the rewound message text.
   */
  rewind(sessionFile: string, anchor: string, projectId: string): Promise<{ editorText?: string }>
  /** Empty the session's steer/follow-up queue and return the texts (steering first); [] without a live worker. */
  clearQueue(sessionFile: string): Promise<string[]>
  /** New session in the background: never reuses or replaces the desktop's foreground worker. */
  /** The session's entry tree and current leaf (desktop session tree). */
  sessionTree(sessionFile: string, projectId: string): Promise<{ rows: TreeRow[]; leafId: string | null }>
  /** Move the session's leaf to `leafId` (another branch's last entry) on its own worker. */
  switchBranch(sessionFile: string, leafId: string, projectId: string): Promise<void>
  /** Fork before the user entry `anchor` into a new session file of the same project. */
  fork(sessionFile: string, anchor: string, projectId: string): Promise<{ sessionFile: string; editorText?: string }>
  createSession(projectId: string): Promise<string>
  listModels(sessionFile: string): Promise<HostModelList>
  setModel(sessionFile: string, modelId: string): Promise<string>
  setThinking(sessionFile: string, level: string): Promise<void>
  /** Store a phone attachment where prompt paths can reference it (desktop clipboard-image dir). */
  saveAttachment(bytes: Uint8Array, name: string, mime: string): Promise<string>
  /** Bytes of a stored attachment, or null when `path` is not a `pi-clipboard-*` file in the attachment dir. */
  readAttachment(path: string): Promise<{ bytes: Uint8Array; mime: string } | null>

  respondUi(response: UiResponse): void
  cancelUi(id: string): void
  /** Close a dialog the desktop is showing because a remote client answered it. */
  dismissDesktopUi(id: string): void

  /** Slash commands for a project folder, from disk and extension probes (never spawns or touches a worker). */
  listCommands(projectId: string): Promise<CommandInfo[]>
  /** Context usage of a session (live worker first, disk otherwise); null when unreadable. */
  contextStats(sessionFile: string, projectId: string): Promise<ContextStats | null>
  /** A folder under the project root, or null when `path` escapes it / is not a folder. */
  /** The project's working tree against HEAD as `git diff` text (incl. untracked text files). */
  gitDiff(projectId: string): Promise<{ isRepo: boolean; branch: string; raw: string; message?: string }>
  listDir(projectId: string, path: string, dotfiles: boolean): Promise<{ entries: FileEntry[]; truncated: boolean } | null>
  searchFiles(projectId: string, query: string): Promise<FileEntry[]>
  capabilityCatalog(): CapabilityInfo[]
  sessionCapabilities(sessionFile: string): string[]
  setSessionCapabilities(sessionFile: string, ids: string[]): void
  getCacheWarming(): Promise<CacheWarming>
  setCacheWarming(mode: CacheWarming): Promise<CacheWarming>
  /** Tell the desktop renderer a setting changed underneath it. */
  notifySettingsChanged(key: 'cacheWarming' | 'capabilities' | 'rewound', sessionFile?: string): void
  /** A remotely created session now exists on disk: the desktop sidebar should re-list this project. */
  notifySessionsChanged(projectId: string): void

  toolCardFor(toolName: string, projectId: string): ToolCardDef | undefined

  storage: { get(key: string): unknown; set(key: string, value: unknown): void }
  secrets: { available(): boolean; seal(plain: string): string; open(sealed: string): string | null }
  /** Absolute path of a whitelisted static asset (e.g. mermaid.min.js), or null. */
  assetPath(name: string): string | null
  log(level: 'info' | 'warn' | 'error', message: string): void
}

/** Events the desktop pushes into the gateway (see `tap.ts`). */
export type RemoteTapSink = {
  appEvent(event: AppEvent): void
  uiRequest(request: UiRequest): void
  uiResolved(id: string, by: 'desktop' | 'remote' | 'system'): void
  settingsChanged(key: 'cacheWarming' | 'capabilities', sessionFile?: string): void
}
