export type WorkspaceSessionChoice = {
  sessionId: string
  sessionFile?: string
  title?: string
  updatedAt?: number
}

export type WorkspaceSessionChoiceOptions = {
  sessionId?: string
  sessionFile?: string
}

export function chooseWorkspaceSession(
  sessions: WorkspaceSessionChoice[],
  options?: WorkspaceSessionChoiceOptions,
): WorkspaceSessionChoice | null {
  if (options?.sessionId && options.sessionFile) {
    return { sessionId: options.sessionId, sessionFile: options.sessionFile }
  }

  return (
    sessions.find((s) => s.sessionId === options?.sessionId) ||
    sessions.find((s) => s.sessionFile === options?.sessionFile) ||
    sessions[0] ||
    null
  )
}
