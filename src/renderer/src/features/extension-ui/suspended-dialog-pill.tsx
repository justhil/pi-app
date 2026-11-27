import { useTranslation } from 'react-i18next'
import { MessageSquare, X } from '@renderer/components/icons'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  clearExtensionToolRowFlags,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'

/**
 * Compact pill above Composer whenever the user deferred an AskUserQuestion / extension dialog
 * with "Answer later", so they can scroll chat/files freely and jump back in one click.
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

  const label =
    suspended.pending.method === 'ask_user_question'
      ? suspended.pending.questions[0]?.header ||
        suspended.pending.questions[0]?.question ||
        t('extension:resumeWaitingAnswer')
      : suspended.pending.method === 'image_review'
        ? suspended.pending.payload.title || t('extension:resumeWaitingAnswer')
        : suspended.pending.title || t('extension:resumeWaitingAnswer')

  return (
    <div
      data-pi-slot="composer-suspended-question"
      className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/[0.08] py-0.5 pl-2.5 pr-1 text-[11.5px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/[0.1] dark:text-amber-200"
    >
      <button
        type="button"
        onClick={resumeSuspended}
        className="flex min-w-0 items-center gap-1.5 text-left transition-opacity hover:opacity-85"
      >
        <MessageSquare className="h-3 w-3 shrink-0" />
        <span className="max-w-[200px] truncate font-medium">{label}</span>
        <span className="shrink-0 opacity-75">· {t('extension:continueAnswer')}</span>
      </button>
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
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-65 transition-colors hover:bg-amber-500/15 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
