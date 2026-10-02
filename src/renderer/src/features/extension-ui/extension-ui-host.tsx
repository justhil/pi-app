import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { QuestionnaireDialog, type AskQuestionPayload } from './questionnaire-dialog'
import { ImageReviewDialog, type ImageReviewPayload } from './image-review-dialog'
import { ExtensionDialogShell } from './extension-dialog-shell'
import {
  useExtensionUIStore,
  type ExtensionUIPending,
} from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  clearExtensionToolRowFlags,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'


function respond(payload: {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
  result?: unknown
}) {
  ipcClient.invoke('extension.respondUI', payload).catch(() => {})
}

function findToolContextForUi(): { toolCallId?: string; toolName?: string; timelineItemId?: string } {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolPhase === 'start' || it.toolPhase === 'update') {
      return {
        toolCallId: it.toolCallId,
        toolName: it.toolName,
        timelineItemId: it.id,
      }
    }
  }
  const suspended = useExtensionUIStore.getState().suspended
  if (suspended?.timelineItemId) {
    return {
      toolCallId: suspended.toolCallId,
      toolName: suspended.toolName,
      timelineItemId: suspended.timelineItemId,
    }
  }
  return {}
}

function suspendActiveDialog() {
  const meta = findToolContextForUi()
  useExtensionUIStore.getState().suspendActive(meta)
  const { timelineItemId } = meta
  if (timelineItemId) {
    useUIStore.getState().updateTimelineItem(timelineItemId, {
      extensionUiSuspended: true,
      toolStatusLine: i18n.t('extension:waitingAnswer'),
    })
  }
  toast.message(i18n.t('extension:suspendedToast'))
}

/** Option list for `ui.select`: number keys pick, arrows move focus. */
function SelectDialog({ title, options, onPick, onSuspend, onCancel }: {
  title: string
  options: string[]
  onPick: (value: string) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [])
  const focusRow = (delta: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const current = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[(current + delta + rows.length) % rows.length]?.focus()
  }
  return (
    <ExtensionDialogShell title={title} onDismiss={onSuspend} wide>
      <div
        ref={listRef}
        role="listbox"
        aria-label={title}
        className="-mx-1 flex max-h-[min(70vh,480px)] flex-col gap-1 overflow-y-auto px-1 py-0.5"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            focusRow(event.key === 'ArrowDown' ? 1 : -1)
          } else if (/^[1-9]$/.test(event.key) && options[Number(event.key) - 1] !== undefined) {
            event.preventDefault()
            onPick(options[Number(event.key) - 1])
          }
        }}
      >
        {options.map((option, index) => (
          <button
            key={`${index}:${option}`}
            type="button"
            role="option"
            aria-selected={false}
            className="questionnaire-option flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-left text-[13px] outline-none hover:border-border hover:bg-accent/40 focus-visible:border-primary/45 focus-visible:bg-primary/[0.06]"
            onClick={() => onPick(option)}
          >
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{option}</span>
            {index < 9 && (
              <kbd className="rounded border border-border/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground/60">{index + 1}</kbd>
            )}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground/55">{t('extension:selectKeys')}</span>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onCancel}
        >
          {t('extension:cancelNotifyExt')}
        </button>
      </div>
    </ExtensionDialogShell>
  )
}

function ConfirmDialog({ title, message, onAnswer, onSuspend, onCancel }: {
  title: string
  message: string
  onAnswer: (confirmed: boolean) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const yesRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    yesRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <ExtensionDialogShell title={title} onDismiss={onSuspend} wide>
      {message.trim() && (
        <div className="mb-4 max-h-[min(50vh,320px)] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/85">
          {message}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="mr-auto rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground" onClick={onCancel}>
          {t('extension:cancel')}
        </button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-muted" onClick={() => onAnswer(false)}>
          {t('extension:no')}
        </button>
        <button
          ref={yesRef}
          type="button"
          className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
          onClick={() => onAnswer(true)}
        >
          {t('extension:yes')}
        </button>
      </div>
    </ExtensionDialogShell>
  )
}

function InputDialog({ title, placeholder, onSubmit, onSuspend, onCancel }: {
  title: string
  placeholder?: string
  onSubmit: (value: string) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  return (
    <ExtensionDialogShell title={title} onDismiss={onSuspend}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(value)
        }}
      >
        <input
          autoFocus
          className="mb-4 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/50"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-muted" onClick={onCancel}>
            {t('extension:cancel')}
          </button>
          <button type="submit" className={cn('rounded-md bg-primary px-3.5 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90')}>
            {t('extension:confirm')}
          </button>
        </div>
      </form>
    </ExtensionDialogShell>
  )
}

export function ExtensionUIHost() {
  const pending = useExtensionUIStore((s) => s.activePending)
  const clearAfterRespond = useExtensionUIStore((s) => s.clearAfterRespond)

  const cancelWorker = (id: string) => {
    const tid = findToolContextForUi().timelineItemId
    respond({ id, cancelled: true })
    clearExtensionToolRowFlags(tid)
    clearAfterRespond()
    reconcileStaleInteractiveToolRows(id)
  }

  if (!pending) return null

  const answer = (payload: { value?: string; confirmed?: boolean }) => {
    respond({ id: pending.id, ...payload })
    clearAfterRespond()
  }

  // Keyed by request id: a new request never inherits the previous dialog's state.
  switch (pending.method) {
    case 'ask_user_question':
      return (
        <QuestionnaireDialog
          key={pending.id}
          requestId={pending.id}
          questions={pending.questions}
          onSubmit={(result) => {
            const s = useExtensionUIStore.getState().suspended
            const tid = findToolContextForUi().timelineItemId || s?.timelineItemId
            respond({ id: pending.id, result })
            clearExtensionToolRowFlags(tid)
            clearAfterRespond()
            if (result.cancelled) reconcileStaleInteractiveToolRows(pending.id)
          }}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      )
    case 'image_review':
      return (
        <ImageReviewDialog
          key={pending.id}
          payload={pending.payload}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
          onSubmit={(r) => {
            respond({ id: pending.id, result: r })
            clearAfterRespond()
          }}
        />
      )
    case 'select':
      return (
        <SelectDialog
          key={pending.id}
          title={pending.title}
          options={pending.options}
          onPick={(value) => answer({ value })}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      )
    case 'confirm':
      return (
        <ConfirmDialog
          key={pending.id}
          title={pending.title}
          message={pending.message}
          onAnswer={(confirmed) => answer({ confirmed })}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      )
    default:
      return (
        <InputDialog
          key={pending.id}
          title={pending.title}
          placeholder={pending.placeholder}
          onSubmit={(value) => answer({ value })}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      )
  }
}
