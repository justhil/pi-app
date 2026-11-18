import type { EditableMessageRole } from '@shared/session-message-edit'
import { rewriteSessionMessageFileAtomically } from '@shared/session-message-edit-io'
import { sessionFilePathForFs } from './session-file-meta'
import { workerManager } from './worker-manager'

export async function editPiSessionMessageOnDisk(opts: {
  sessionFile: string
  entryId: string
  text: string
}): Promise<{ ok: boolean; role?: EditableMessageRole; error?: string }> {
  const { sessionFile, entryId, text } = opts
  const liveResult =
    typeof workerManager.editSessionMessageOnLiveWorker === 'function'
      ? await workerManager.editSessionMessageOnLiveWorker(sessionFile, entryId, text)
      : null
  if (liveResult !== null) {
    return liveResult
  }
  const fsPath = sessionFilePathForFs(sessionFile)
  if (!fsPath) return { ok: false, error: 'invalid_session_path' }
  return rewriteSessionMessageFileAtomically(fsPath, entryId, text)
}
