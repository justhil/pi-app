import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

export type WorkerExitInfo = {
  code: number
  cwd: string
  sessionFile?: string | null
  poolKey?: string | null
}

export function clearExitedSessionRuntime(
  info: WorkerExitInfo,
  setSessionRuntimeRunning: (sessionFile: string, running: boolean) => void,
  setCompactingSession: (sessionFile: string, active: boolean) => void,
): void {
  const sessionFile = normalizeSessionFileKey(info.sessionFile || '') || info.sessionFile || ''
  if (!sessionFile) return
  setSessionRuntimeRunning(sessionFile, false)
  setCompactingSession(sessionFile, false)
}
