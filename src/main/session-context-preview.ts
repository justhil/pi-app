import { buildSessionContextPreview, type SessionContextPreview } from '@shared/session-context-preview'
import type { PiSessionMessage } from '@shared/worker-message'
import { getActiveSdkModule } from './ipc/sdk-session'

export async function getSessionContextPreviewFromDisk(
  sessionFile: string,
  leafId?: string | null,
): Promise<SessionContextPreview> {
  const { SessionManager } = await getActiveSdkModule()
  const session = SessionManager.open(sessionFile)
  if (leafId === null) session.resetLeaf()
  else if (typeof leafId === 'string' && leafId.length > 0) session.branch(leafId)

  const context = session.buildSessionContext()
  return buildSessionContextPreview({
    sessionId: session.getSessionId(),
    sessionFile,
    messages: (context.messages || []) as PiSessionMessage[],
  })
}
