import { useTranslation } from 'react-i18next'
import { MessageCircleQuestion, X } from '@renderer/components/icons'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  clearExtensionToolRowFlags,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'
import { QuestionnaireCountdownBadge } from './questionnaire-countdown-badge'

/**
 * Docked tray row inside `.composer-accessory-row` when the user deferred an extension
 * questionnaire ("Answer later"), matching the Todo tray's height and typography.
 */
export function SuspendedExtensionDialogPill() {
  const { t } = useTranslation()
  const suspended = useExtensionUIStore((s) => s.suspended)
  const resumeSuspended = useExtensionUIStore((s) => s.resumeSuspended)
  const dismissById = useExtensionUIStore((s) => s.dismissById)
  const historySessionFile = useUIStore((s) => s.historySessionFile)

  if (!suspended) return null
  const reqSession = suspended.pending.sessionFile
  if (reqSession && historySessionFile && !sessionFilesEqual(reqSession, historySessionFile)) {
    return null
  }

  const pending = suspended.pending
  const label =
    pending.method === 'ask_user_question'
      ? pending.questions[0]?.header ||
        pending.questions[0]?.question ||
        t('extension:resumeWaitingAnswer')
      : pending.method === 'image_review'
        ? pending.payload.title || t('extension:resumeWaitingAnswer')
        : pending.title || t('extension:resumeWaitingAnswer')

  const deadlineAt = 'deadlineAt' in pending ? pending.deadlineAt : undefined
  const timeoutMs = 'timeoutMs' in pending ? pending.timeoutMs : undefined

  return (
    <div
      data-pi-slot="composer-suspended-question"
      className="pointer-events-auto flex h-7 min-w-0 items-center gap-1.5 text-[12px]"
    >
      <button
        type="button"
        onClick={resumeSuspended}
        className="flex min-w-0 items-center gap-1.5 text-left text-foreground-secondary transition-colors hover:text-foreground"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span className="max-w-[220px] truncate font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground">· {t('extension:continueAnswer')}</span>
      </button>
      <QuestionnaireCountdownBadge deadlineAt={deadlineAt} timeoutMs={timeoutMs} compact />
      <button
        type="button"
        title={t('extension:cancel')}
        aria-label={t('extension:cancel')}
        onClick={() => {
          const id = suspended.requestId
          void ipcClient.invoke('extension.respondUI', { id, cancelled: true }).catch(() => {})
          clearExtensionToolRowFlags(suspended.timelineItemId)
          dismissById(id)
          reconcileStaleInteractiveToolRows(id)
        }}
        className="chrome-icon-btn inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
