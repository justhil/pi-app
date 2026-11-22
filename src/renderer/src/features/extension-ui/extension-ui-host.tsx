import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { QuestionnaireDialog, type AskQuestionPayload } from './questionnaire-dialog'
import { hasRichMarkdownSyntax, QuestionnaireMarkdown } from './questionnaire-markdown'
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

export type { AskQuestionPayload, ImageReviewPayload, ExtensionUIPending }

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

type RewindOptionDisplay = {
  label: string
  description?: string
  danger?: boolean
}

function mapRewindOption(raw: string, t: (key: string) => string): RewindOptionDisplay | null {
  switch (raw) {
    case 'Keep current files':
    case 'Conversation only (keep current files)':
      return {
        label: t('extension:rewindPrompt.keepFiles'),
        description: t('extension:rewindPrompt.keepFilesDesc'),
      }
    case 'Restore files to that point':
      return {
        label: t('extension:rewindPrompt.restoreFiles'),
        description: t('extension:rewindPrompt.restoreFilesDesc'),
      }
    case 'Restore all (files + conversation)':
      return {
        label: t('extension:rewindPrompt.restoreAll'),
        description: t('extension:rewindPrompt.restoreAllDesc'),
      }
    case 'Code only (restore files, keep conversation)':
      return {
        label: t('extension:rewindPrompt.codeOnly'),
        description: t('extension:rewindPrompt.codeOnlyDesc'),
      }
    case 'Undo last file rewind':
      return {
        label: t('extension:rewindPrompt.undoFileRewind'),
        description: t('extension:rewindPrompt.undoFileRewindDesc'),
      }
    case 'Cancel navigation':
      return {
        label: t('extension:rewindPrompt.cancel'),
        description: t('extension:rewindPrompt.cancelDesc'),
        danger: true,
      }
    default:
      return null
  }
}

/** Option list for ui.select: controlled hover + keyboard highlight, localized rewind options. */
function SelectDialog({
  title,
  options,
  suspendable,
  onPick,
  onSuspend,
  onCancel,
}: {
  title: string
  options: string[]
  suspendable: boolean
  onPick: (value: string) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const isRewindPrompt = title === 'Restore Options'
  const displayTitle = isRewindPrompt ? t('extension:rewindPrompt.title') : title
  const displaySubtitle = isRewindPrompt ? t('extension:rewindPrompt.subtitle') : undefined

  useEffect(() => {
    setActiveIndex(0)
    listRef.current?.querySelector<HTMLButtonElement>('button[role="option"]')?.focus({ preventScroll: true })
  }, [title, options])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (options.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((cur) => {
          const next = (cur + 1) % options.length
          listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]')[next]?.focus({ preventScroll: true })
          return next
        })
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((cur) => {
          const prev = (cur - 1 + options.length) % options.length
          listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]')[prev]?.focus({ preventScroll: true })
          return prev
        })
        return
      }
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        const target = options[activeIndex]
        if (target !== undefined) onPick(target)
        return
      }
      if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const option = options[Number(event.key) - 1]
        if (option !== undefined) {
          event.preventDefault()
          onPick(option)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, options, onPick])

  return (
    <ExtensionDialogShell
      title={displayTitle}
      subtitle={displaySubtitle}
      maxWidthClass="max-w-[440px]"
      suspendable={suspendable}
      onSuspend={suspendable ? onSuspend : onCancel}
    >
      <div ref={listRef} className="flex flex-col gap-1.5" role="listbox" aria-label={displayTitle}>
        {options.map((opt, index) => {
          const mapped = isRewindPrompt ? mapRewindOption(opt, t) : null
          const active = index === activeIndex
          return (
            <button
              key={`${opt}-${index}`}
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => onPick(opt)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors duration-[120ms]',
                active
                  ? mapped?.danger
                    ? 'border-destructive/35 bg-destructive/[0.06] text-destructive'
                    : 'border-[var(--brand)]/55 bg-[var(--brand)]/[0.07] text-foreground'
                  : 'border-border/65 bg-background/70 text-foreground hover:border-border hover:bg-[var(--bg-hover)]',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className={cn('text-[13px] font-medium leading-snug', mapped?.danger && active && 'text-destructive')}>
                  {mapped ? mapped.label : opt}
                </div>
                {mapped?.description && (
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {mapped.description}
                  </div>
                )}
              </div>
              {index < 9 && (
                <kbd
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10.5px]',
                    active
                      ? 'border-[var(--brand)]/35 bg-background text-foreground'
                      : 'border-border/70 bg-muted/40 text-muted-foreground',
                  )}
                >
                  {index + 1}
                </kbd>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-3.5 flex items-center justify-between border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
        <span>{suspendable ? t('extension:selectKeys') : t('extension:selectKeysDirect')}</span>
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          onClick={onCancel}
        >
          {t('extension:cancel')}
        </button>
      </div>
    </ExtensionDialogShell>
  )
}

function ConfirmDialog({
  title,
  message,
  suspendable,
  onAnswer,
  onSuspend,
  onCancel,
}: {
  title: string
  message: string
  suspendable: boolean
  onAnswer: (ok: boolean) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const rich = hasRichMarkdownSyntax(message)
  return (
    <ExtensionDialogShell
      title={title}
      maxWidthClass={rich || message.length > 180 ? 'max-w-lg' : 'max-w-md'}
      suspendable={suspendable}
      onSuspend={suspendable ? onSuspend : onCancel}
    >
      <div className="mb-4 text-[13px] leading-relaxed text-foreground-secondary">
        {rich ? (
          <QuestionnaireMarkdown content={message} compact plainHeadings />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message}</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          onClick={() => onAnswer(false)}
        >
          {t('extension:no')}
        </button>
        <button
          type="button"
          autoFocus
          className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          onClick={() => onAnswer(true)}
        >
          {t('extension:yes')}
        </button>
      </div>
    </ExtensionDialogShell>
  )
}

function InputDialog({
  title,
  placeholder,
  suspendable,
  onSubmit,
  onSuspend,
  onCancel,
}: {
  title: string
  placeholder?: string
  suspendable: boolean
  onSubmit: (value: string) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  return (
    <ExtensionDialogShell
      title={title}
      maxWidthClass="max-w-md"
      suspendable={suspendable}
      onSuspend={suspendable ? onSuspend : onCancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(value)
        }}
      >
        <input
          autoFocus
          className="mb-4 w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary/55"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={onCancel}
          >
            {t('extension:cancel')}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t('extension:confirm')}
          </button>
        </div>
      </form>
    </ExtensionDialogShell>
  )
}

export function ExtensionUIHost() {
  const pending = useExtensionUIStore((s) => s.activePending)
  const inlineHostMounted = useExtensionUIStore((s) => s.inlineHostMounted)
  const inlineQuestionnaireExpandedModal = useExtensionUIStore((s) => s.inlineQuestionnaireExpandedModal)
  const clearAfterRespond = useExtensionUIStore((s) => s.clearAfterRespond)

  const cancelWorker = (id: string) => {
    const tid = findToolContextForUi().timelineItemId
    respond({ id, cancelled: true })
    clearExtensionToolRowFlags(tid)
    clearAfterRespond()
    reconcileStaleInteractiveToolRows(id)
  }

  if (!pending) return null

  const toolCtx = findToolContextForUi()
  // Only allow "Answer later" suspension when backed by an interactive tool call.
  // Navigation hooks like pi-rewind-hook's Restore Options have no timeline tool row and must cancel directly.
  const canSuspend =
    pending.method === 'ask_user_question' ||
    pending.method === 'image_review' ||
    Boolean(toolCtx.timelineItemId)

  const answer = (payload: { value?: string; confirmed?: boolean }) => {
    respond({ id: pending.id, ...payload })
    clearAfterRespond()
  }

  switch (pending.method) {
    case 'ask_user_question':
      // Rendered inline above Composer when chat composer is mounted (unless user popped out modal).
      if (inlineHostMounted && !inlineQuestionnaireExpandedModal) return null
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
          suspendable={canSuspend}
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
          suspendable={canSuspend}
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
          suspendable={canSuspend}
          onSubmit={(value) => answer({ value })}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      )
  }
}
