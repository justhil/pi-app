import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { QuestionnaireDialog, type AskQuestionPayload } from './questionnaire-dialog'
import { ImageReviewDialog, type ImageReviewPayload } from './image-review-dialog'
import { ExtensionDialogShell } from './extension-dialog-shell'
import {
  useExtensionUIStore,
  type ExtensionUIPending,
} from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'


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
      toolStatusLine: '等待你的作答（点击「继续作答」）',
    })
  }
  toast.message('已挂起，可在时间线该工具行点击「继续作答」')
}

export function ExtensionUIHost() {
  const { t } = useTranslation()
  const pending = useExtensionUIStore((s) => s.activePending)
  const clearAfterRespond = useExtensionUIStore((s) => s.clearAfterRespond)
  const [inputValue, setInputValue] = useState('')

  const cancelWorker = (id: string) => {
    respond({ id, cancelled: true })
    clearAfterRespond()
  }

  if (!pending) return null

  return (
    <>
      {pending.method === 'ask_user_question' ? (
        <QuestionnaireDialog
          requestId={pending.id}
          questions={pending.questions}
          onSubmit={(result) => {
            respond({ id: pending.id, result })
            const s = useExtensionUIStore.getState().suspended
            const tid = findToolContextForUi().timelineItemId || s?.timelineItemId
            if (tid) {
              useUIStore.getState().updateTimelineItem(tid, {
                extensionUiSuspended: false,
                extensionUiRequestId: undefined,
              })
            }
            clearAfterRespond()
          }}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
        />
      ) : pending.method === 'image_review' ? (
        <ImageReviewDialog
          payload={pending.payload}
          onSuspend={suspendActiveDialog}
          onCancel={() => cancelWorker(pending.id)}
          onSubmit={(r) => {
            respond({ id: pending.id, result: r })
            clearAfterRespond()
          }}
        />
      ) : pending.method === 'select' ? (
        <ExtensionDialogShell title={pending.title} onDismiss={suspendActiveDialog} wide>
          <div className="flex max-h-[min(70vh,480px)] flex-col gap-1 overflow-y-auto">
            {pending.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className="rounded-md border px-3 py-2 text-left text-[13px] hover:bg-accent"
                onClick={() => {
                  respond({ id: pending.id, value: opt })
                  clearAfterRespond()
                }}
              >
                {opt}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 w-full rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted"
            onClick={() => cancelWorker(pending.id)}
          >
            {t('extension:cancelNotifyExt')}
          </button>
        </ExtensionDialogShell>
      ) : pending.method === 'confirm' ? (
        <ExtensionDialogShell title={pending.title} onDismiss={suspendActiveDialog} wide>
          <pre className="mb-4 max-h-[min(50vh,320px)] overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-3 text-[11px] font-mono leading-relaxed text-muted-foreground">
            {pending.message}
          </pre>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-[13px]" onClick={() => cancelWorker(pending.id)}>
              {t('extension:cancel')}
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-[13px]"
              onClick={() => {
                respond({ id: pending.id, confirmed: false })
                clearAfterRespond()
              }}
            >
              {t('extension:no')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                respond({ id: pending.id, confirmed: true })
                clearAfterRespond()
              }}
            >
              {t('extension:yes')}
            </button>
          </div>
        </ExtensionDialogShell>
      ) : (
        <ExtensionDialogShell title={pending.title} onDismiss={suspendActiveDialog}>
          <input
            className="mb-4 w-full rounded-md border px-3 py-2 text-[13px]"
            value={inputValue}
            placeholder={pending.placeholder}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-[13px]" onClick={() => cancelWorker(pending.id)}>
              {t('extension:cancel')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
              onClick={() => {
                respond({ id: pending.id, value: inputValue })
                clearAfterRespond()
              }}
            >
              {t('extension:confirm')}
            </button>
          </div>
        </ExtensionDialogShell>
      )}
    </>
  )
}