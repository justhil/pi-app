import { toast } from 'sonner'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import i18n from '@renderer/lib/i18n'

export type NotificationOpenPayload = {
  ok: boolean
  reason?: string
  workspaceId?: string
  sessionId?: string
  sessionFile?: string
}

export async function handleNotificationOpenSession(payload: NotificationOpenPayload): Promise<void> {
  if (!payload.ok) {
    toast.error(i18n.t(payload.reason === 'gone' ? 'common:notification.sessionGone' : 'common:notification.openFailed'))
    return
  }
  if (!payload.workspaceId) return
  try {
    await activateWorkspace(payload.workspaceId, {
      sessionId: payload.sessionId,
      sessionFile: payload.sessionFile,
    })
  } catch {
    toast.error(i18n.t('common:notification.openFailed'))
  }
}
