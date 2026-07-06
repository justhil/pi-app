import { dirname } from 'path'
import { getActiveSdkModule } from './ipc/sdk-session'
import { workerManager } from './worker-manager'

/** 与 pi TUI `/name`、session selector rename 一致：追加 JSONL `session_info`。 */
export async function renamePiSessionOnDisk(
  sessionFile: string,
  title: string,
  workspaceCwd?: string,
): Promise<{ ok: boolean; error?: string }> {
  const name = title.trim()
  if (!name) return { ok: false, error: 'empty title' }
  const cwd = workspaceCwd || workerManager.cwd || dirname(sessionFile)

  if (workerManager.isRunning && workerManager.cwd) {
    const r = await workerManager.renameSessionFile(sessionFile, name)
    if (r.ok) return { ok: true }
    // Worker 可能未就绪或路径不匹配，回退主进程直接写 JSONL
  }

  try {
    const { SessionManager } = await getActiveSdkModule()
    const sm = SessionManager.open(sessionFile, undefined, cwd)
    sm.appendSessionInfo(name)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}