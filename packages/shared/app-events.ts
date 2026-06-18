// AppEvent - Unified event model for Renderer/Main/Worker communication
// This file will be fully implemented in the ipc-contract task

export interface AppEventBase {
  seq: number
  workspaceId: string
  sessionId?: string
  runId?: string
  turnId?: string
  timestamp: number
}

export interface MessageEvent extends AppEventBase {
  type: 'message'
  role: 'user' | 'assistant' | 'system'
  phase: 'start' | 'delta' | 'end'
  text?: string
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

export interface RunEvent extends AppEventBase {
  type: 'run'
  phase: 'started' | 'running' | 'idle' | 'failed' | 'cancelled'
  model?: string
  thinkingLevel?: string
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

export type AppEvent = MessageEvent | ToolEvent | FileEvent | RunEvent
