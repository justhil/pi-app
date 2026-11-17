import type { TreeRow } from './branches'
import type { AppEvent } from '@shared/app-events'
import type { CapabilityInfo } from '@shared/capabilities'
import type {
  CacheWarming,
  CommandInfo,
  ContextStats,
  FileEntry,
  FileReadResult,
  HostBrowseResult,
  PurgeSend,
  PurgeStateResult,
  SessionUsage,
  UiRequest,
  UiResponse,
  UsageSummaryResult,
} from '@shared/remote'
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
  parentSessionFile?: string
  forkedFromSessionFile?: string
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
export type RemoteSettingsKey = 'cacheWarming' | 'capabilities' | 'purge' | 'projects' | 'models' | 'rewound'
export type ProjectMeta = { label?: string; temporary?: boolean; branch?: string; repo?: string }

export interface RemoteHostPort {
  hostName(): string
  appVersion(): string

  /** Projects the desktop trusts (recent projects + discovered worktrees/sandboxes/history). */
  trustedProjects(): string[]
  /** Refresh discovered projects asynchronously before listing projects or sessions. */
  refreshProjects?(): Promise<void>
  /** Validate and admit an arbitrary host folder when `allowAllProjects` is enabled. */
  admitProject?(projectId: string): Promise<string | null>
  /** Browse host directories when `allowAllProjects` is enabled. */
  browseHostDir?(path?: string, dotfiles?: boolean): Promise<HostBrowseResult>
  /** Display info for a project folder: temporary chats live in sandbox dirs named by a random id. */
  projectInfo?(path: string): ProjectMeta
  /** Normalized session keys currently running in live desktop workers. */
  liveRunningSessions?(): Set<string>
  listSessions(projectId: string): Promise<HostSessionRow[]>
  /** Workspace the session belongs to (header cwd), or null when unknown / unreadable. */
  sessionProject(sessionFile: string): Promise<string | null>
  /** Disk-first history for an authorized session; never spawns a worker. */
  readHistory(projectId: string, sessionFile: string): Promise<HostSessionHistory>
  liveState(sessionFile: string): Promise<HostLiveState>

  /** `projectId` is the session's (whitelisted) workspace: the cwd fallback when its file has no header yet. */
  send(sessionFile: string, text: string, mode: SendMode, capabilities: string[], projectId: string, agentPurge?: PurgeSend): Promise<void>
  abort(sessionFile: string): Promise<void>
  /**
   * Move the session's leaf to just before the user entry `anchor` (desktop rewind). Binds the
   * session's own worker (cwd `projectId`) when it has none; returns the rewound message text.
   */
  rewind(sessionFile: string, anchor: string, projectId: string): Promise<{ editorText?: string }>
  /** Empty the session's steer/follow-up queue (or pull only item `index` and re-queue the rest) and return the removed texts. */
  clearQueue(sessionFile: string, index?: number): Promise<string[]>
  /** New session in the background: never reuses or replaces the desktop's foreground worker. */
  /** The session's entry tree and current leaf (desktop session tree). */
  sessionTree(sessionFile: string, projectId: string): Promise<{ rows: TreeRow[]; leafId: string | null }>
  /** Move the session's leaf to `leafId` (another branch's last entry) on its own worker. */
  switchBranch(sessionFile: string, leafId: string, projectId: string): Promise<void>
  /** Fork before the user entry `anchor` into a new session file of the same project. */
  fork(sessionFile: string, anchor: string, projectId: string): Promise<{ sessionFile: string; editorText?: string }>
  createSession(projectId: string): Promise<string>
  renameSession?(sessionFile: string, title: string, projectId: string): Promise<string>
  deleteSession?(sessionFile: string, projectId: string): Promise<boolean>
  getPurgeState?(sessionFile?: string): Promise<PurgeStateResult>
  setPurgeState?(sessionFile: string, req: PurgeSend): Promise<PurgeStateResult>
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
  /** Summed `usage` of the session file's replies (phone session panel). */
  sessionUsage(sessionFile: string): Promise<SessionUsage | null>
  /** A folder under the project root, or null when `path` escapes it / is not a folder. */
  /** The project's working tree against HEAD as `git diff` text (incl. untracked text files). */
  gitDiff(projectId: string): Promise<{ isRepo: boolean; branch: string; raw: string; message?: string }>
  listDir(projectId: string, path: string, dotfiles: boolean): Promise<{ entries: FileEntry[]; truncated: boolean } | null>
  searchFiles(projectId: string, query: string): Promise<FileEntry[]>
  readFile?(projectId: string, path: string): Promise<
    { ok: true; value: FileReadResult } | { ok: false; code: 'not_found' | 'forbidden' | 'bad_request'; message: string }
  >
  usageSummary?(days: number): Promise<UsageSummaryResult>
  capabilityCatalog(): CapabilityInfo[]
  sessionCapabilities(sessionFile: string): string[]
  setSessionCapabilities(sessionFile: string, ids: string[]): void
  getCacheWarming(): Promise<CacheWarming>
  setCacheWarming(mode: CacheWarming): Promise<CacheWarming>
  /** Tell the desktop renderer a setting changed underneath it. */
  notifySettingsChanged(key: 'cacheWarming' | 'capabilities' | 'rewound' | 'purge', sessionFile?: string): void
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
  settingsChanged(key: RemoteSettingsKey, sessionFile?: string): void
  sessionsChanged?(projectId?: string, removedSessionFile?: string): void
  branchMoved?(sessionFile: string): void
}
