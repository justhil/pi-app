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
}

export function diskProjectName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

export function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}