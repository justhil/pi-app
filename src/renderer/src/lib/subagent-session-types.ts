export type SubagentSessionState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'detached'
  | 'unknown'

export type SubagentSessionChild = {
  key: string
  agent: string
  task?: string
  state: SubagentSessionState
  sessionFile?: string
}

export type SubagentSessionGroup = {
  workspacePath: string
  parentSessionId: string
  parentSessionFile: string
  previewSessionFile: string
  children: SubagentSessionChild[]
}
