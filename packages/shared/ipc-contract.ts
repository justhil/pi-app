// IPC Contract - Shared types for Renderer/Main/Worker communication
// This file will be fully implemented in the ipc-contract task

export type WorkspaceId = string
export type SessionId = string
export type RunId = string
export type TurnId = string

// Placeholder - full implementation in ipc-contract task
export interface PiDesktopIPC {
  workspace: {
    open: (path: string) => Promise<void>
    switch: (path: string) => Promise<void>
  }
  session: {
    list: (workspaceId: WorkspaceId) => Promise<unknown[]>
    open: (sessionId: SessionId) => Promise<void>
    new: () => Promise<SessionId>
  }
  prompt: {
    send: (text: string) => Promise<void>
    abort: () => Promise<void>
  }
}
