import {
  invalidateListSessionsCache,
  listSessionsOnDisk,
} from '../main/ipc/sdk-session'
import { getSessionMessagesFromDisk } from '../main/session-messages-from-disk'
import { flattenTreeFromSessionFile } from '../main/session-tree-from-file'

if (!process.parentPort) throw new Error('preview worker requires parentPort')

type PreviewRequest = {
  requestId: string
  type: 'session.list' | 'session.getMessages' | 'session.tree' | 'session.invalidateList'
  payload: Record<string, unknown>
  userDataDir: string
  activeSdkPath?: string | null
}

process.parentPort.on('message', async (event: { data?: PreviewRequest } | PreviewRequest) => {
  const message =
    typeof event === 'object' && event !== null && 'data' in event
      ? event.data
      : event
  if (!message?.requestId) return
  try {
    let result: unknown
    if (message.type === 'session.list') {
      result = await listSessionsOnDisk(
        String(message.payload.workspaceId || ''),
        message.userDataDir,
        undefined,
        message.activeSdkPath,
      )
    } else if (message.type === 'session.invalidateList') {
      invalidateListSessionsCache(
        typeof message.payload.workspaceId === 'string' && message.payload.workspaceId
          ? message.payload.workspaceId
          : undefined,
      )
      result = null
    } else if (message.type === 'session.getMessages') {
      result = await getSessionMessagesFromDisk(
        String(message.payload.sessionFile || ''),
        Number(message.payload.offset || 0),
        message.payload.limit == null ? undefined : Number(message.payload.limit),
        message.payload.leafId as string | null | undefined,
        message.activeSdkPath,
      )
    } else if (message.type === 'session.tree') {
      result = await flattenTreeFromSessionFile(
        String(message.payload.sessionFile || ''),
        String(message.payload.cwd || ''),
        message.payload.leafId as string | null | undefined,
        message.activeSdkPath,
      )
    } else {
      throw new Error(`Unknown preview request: ${String((message as { type?: string }).type)}`)
    }
    process.parentPort!.postMessage({ requestId: message.requestId, ok: true, result })
  } catch (error) {
    process.parentPort!.postMessage({
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
