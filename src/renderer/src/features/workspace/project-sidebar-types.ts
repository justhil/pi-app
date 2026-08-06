export type SandboxEntry = {
  id: string
  path: string
  label: string
  createdAt: number
  kind: 'sandbox'
  sessionId?: string
  sessionFile?: string
}

export type SessionItem = {
  sessionId: string
  sessionFile?: string
  title: string
  updatedAt: number
  messageCount?: number
  modelId: string
  archivedAt?: number
  /** 所属项目/沙箱路径（用于已归档条目的恢复/删除分发） */
  workspacePath?: string
}

export function diskProjectName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

export function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}