// AppEvent - Unified event model for Renderer/Main/Worker

import type { CompletionOutcome } from './completion-preview'
import type { AdapterWidgetProjection, AdapterWidgetProtocol } from './adapter-widget'

export interface AppEventBase {
  seq: number
  workspaceId: string
  sessionId?: string
  /** pi session JSONL path — stable routing key across UI / Worker */
  sessionFile?: string
  runId?: string
  turnId?: string
  timestamp: number
}

export interface MessageEvent extends AppEventBase {
  type: 'message'
  role: 'user' | 'assistant' | 'system'
  phase: 'start' | 'delta' | 'end'
  text?: string
  /** assistant 流：正文 vs 思维链 */
  contentKind?: 'text' | 'thinking'
  /** pi JSONL entry id（跳转 /tree 用） */
  sessionEntryId?: string
}

export interface ToolEvent extends AppEventBase {
  type: 'tool'
  toolCallId: string
  toolName: string
  phase: 'start' | 'update' | 'end'
  input?: unknown
  output?: unknown
  details?: unknown
  isError?: boolean
}

export interface FileEvent extends AppEventBase {
  type: 'file'
  source: 'edit' | 'write' | 'bash-diff' | 'git'
  path: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
}

/** 回合结束后由 Worker 计算的文件最终净 diff（基线 → 回合结束状态）。 */
export interface TurnDiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  /** unified diff 文本（截断时以标记行结尾） */
  diffText?: string
  truncated?: boolean
  /** 二进制文件：无文本 diff，仅大小/状态 */
  binary?: boolean
  /** 未建立基线的原因（不缓存基线的文件） */
  skipReason?: 'oversize' | 'binary' | 'outside_workspace' | 'unreadable' | 'budget'
  sizeBefore?: number
  sizeAfter?: number
}

export interface TurnDiffEvent extends AppEventBase {
  type: 'turn_diff'
  /** 本 worker 会话生命周期内的回合序号（从 1 起），用于 turnId/runId 不可用时的降级匹配 */
  turnOrdinal?: number
  files: TurnDiffFile[]
}

export interface RunEvent extends AppEventBase {
  type: 'run'
  phase: 'started' | 'running' | 'idle' | 'failed' | 'cancelled' | 'state'
  model?: string
  thinkingLevel?: string
  /** Internal lifecycle marker: emitted only from SDK agent_settled. */
  settled?: boolean
  /**
   * SDK could not restore the session's saved model (missing registry entry / auth)
   * and fell back to another model. Surface in UI — do not leave as worker-only log.
   */
  modelFallbackMessage?: string
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
  toolStats?: {
    total: number
    running: number
    failed: number
  }
}

export interface CompactionEvent extends AppEventBase {
  type: 'compaction'
  phase: 'start' | 'end'
  tokensBefore?: number
  tokensSaved?: number
  summary?: string
}

// B-layer slash command dispatch (R0-1): observable slash execution
export interface SlashEvent extends AppEventBase {
  type: 'slash'
  command: string
  status: 'dispatched' | 'ok' | 'error' | 'info'
  text?: string
}

/** pi AgentSession queue_update：运行中已入队的 steer / follow-up（对齐 TUI 输入框上方淡色展示） */
export interface QueueEvent extends AppEventBase {
  type: 'queue'
  steering: string[]
  followUp: string[]
}

/** Agent 轮次失败 / 中止 / 重试耗尽（时间线 error 卡片） */
export interface AgentErrorEvent extends AppEventBase {
  type: 'agent_error'
  text: string
  kind?: 'error' | 'aborted' | 'retry'
  stopReason?: string
}

/** Worker-owned completion fact. Main is the only delivery-policy owner. */
export interface CompletionEvent extends AppEventBase {
  type: 'completion'
  outcome: CompletionOutcome
  settled: true
  promptPreview?: string
  responsePreview?: string
  durationMs?: number
}

export interface ExtensionWidgetEvent extends AppEventBase {
  type: 'extension_widget'
  phase: 'set' | 'clear'
  widgetKey: string
  adapterId: string
  protocol: AdapterWidgetProtocol
  state?: AdapterWidgetProjection
}

// SDK 安装进度（设置页 UI 用，与会话无关，不继承 AppEventBase）
export interface SdkInstallProgressEvent {
  type: 'sdk-install-progress'
  version: string
  line?: string
  done?: boolean
  error?: string
}

/** Active SDK changed after a successful install/switch; invalidate SDK-owned projections. */
export interface SdkRuntimeChangedEvent {
  type: 'sdk-runtime-changed'
}

export type AppEvent =
  | MessageEvent
  | ToolEvent
  | FileEvent
  | TurnDiffEvent
  | RunEvent
  | CompactionEvent
  | SlashEvent
  | QueueEvent
  | AgentErrorEvent
  | CompletionEvent
  | ExtensionWidgetEvent
  | SdkInstallProgressEvent
  | SdkRuntimeChangedEvent

export const APP_EVENT_CHANNEL = 'app:event'
