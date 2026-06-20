import { useEffect, useState } from 'react'
import { toast, Toaster } from 'sonner'
import { onExtensionUIRequest, ipcClient } from '@renderer/lib/ipc-client'
import { QuestionnaireDialog, type AskQuestionPayload } from './questionnaire-dialog'
import { ImageReviewDialog, type ImageReviewPayload } from './image-review-dialog'
import { ExtensionDialogShell } from './extension-dialog-shell'

type PendingUI =
  | { id: string; method: 'ask_user_question'; questions: AskQuestionPayload[] }
  | { id: string; method: 'select'; title: string; options: string[] }
  | { id: string; method: 'confirm'; title: string; message: string }
  | { id: string; method: 'input'; title: string; placeholder?: string }
  | { id: string; method: 'image_review'; payload: ImageReviewPayload }

function respond(payload: {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
  result?: unknown
}) {
  ipcClient.invoke('extension.respondUI', payload).catch(() => {})
}

export function ExtensionUIHost() {
  const [pending, setPending] = useState<PendingUI | null>(null)
  const [inputValue, setInputValue] = useState('')

  const dismiss = (id: string) => {
    respond({ id, cancelled: true })
    setPending(null)
  }

  useEffect(() => {
    return onExtensionUIRequest((raw) => {
      const req = raw as Record<string, unknown>
      const id = req.id as string
      const method = req.method as string

      if (method === 'notify') {
        const t = (req.notifyType as string) || 'info'
        const msg = req.message as string
        if (t === 'error') toast.error(msg)
        else if (t === 'warning') toast.warning(msg)
        else toast.info(msg)
        return
      }

      if (method === 'custom' && req.kind === 'ask_user_question') {
        setPending({ id, method: 'ask_user_question', questions: (req.questions as AskQuestionPayload[]) || [] })
        return
      }
      if (method === 'custom' && req.kind === 'image_review') {
        setPending({
          id,
          method: 'image_review',
          payload: {
            image: (req.image as string) || '',
            title: (req.title as string) || '图片审查',
            question: (req.question as string) || '这张图片是否可用？',
            context: req.context as string | undefined,
            options: (req.options as string[]) || ['通过', '需要修改', '重做', '取消'],
            allowFeedback: req.allowFeedback !== false,
          },
        })
        return
      }
      if (method === 'select') {
        setPending({ id, method: 'select', title: req.title as string, options: (req.options as string[]) || [] })
        return
      }
      if (method === 'confirm') {
        setPending({ id, method: 'confirm', title: req.title as string, message: req.message as string })
        return
      }
      if (method === 'input') {
        setInputValue('')
        setPending({
          id,
          method: 'input',
          title: req.title as string,
          placeholder: req.placeholder as string | undefined,
        })
      }
    })
  }, [])

  return (
    <>
      <Toaster position="bottom-right" richColors closeButton />
      {pending === null ? null : pending.method === 'ask_user_question' ? (
        <QuestionnaireDialog
          requestId={pending.id}
          questions={pending.questions}
          onSubmit={(result) => {
            respond({ id: pending.id, result })
            setPending(null)
          }}
          onCancel={() => dismiss(pending.id)}
        />
      ) : pending.method === 'image_review' ? (
        <ImageReviewDialog
          payload={pending.payload}
          onCancel={() => dismiss(pending.id)}
          onSubmit={(r) => {
            respond({ id: pending.id, result: r })
            setPending(null)
          }}
        />
      ) : pending.method === 'select' ? (
        <ExtensionDialogShell title={pending.title} onDismiss={() => dismiss(pending.id)} wide>
          <div className="flex max-h-[min(70vh,480px)] flex-col gap-1 overflow-y-auto">
            {pending.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className="rounded-md border px-3 py-2 text-left text-[13px] hover:bg-accent"
                onClick={() => {
                  respond({ id: pending.id, value: opt })
                  setPending(null)
                }}
              >
                {opt}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 w-full rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted"
            onClick={() => dismiss(pending.id)}
          >
            取消
          </button>
        </ExtensionDialogShell>
      ) : pending.method === 'confirm' ? (
        <ExtensionDialogShell title={pending.title} onDismiss={() => dismiss(pending.id)} wide>
          <pre className="mb-4 max-h-[min(50vh,320px)] overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-3 text-[11px] font-mono leading-relaxed text-muted-foreground">
            {pending.message}
          </pre>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-[13px]"
              onClick={() => dismiss(pending.id)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-[13px]"
              onClick={() => {
                respond({ id: pending.id, confirmed: false })
                setPending(null)
              }}
            >
              否
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                respond({ id: pending.id, confirmed: true })
                setPending(null)
              }}
            >
              是
            </button>
          </div>
        </ExtensionDialogShell>
      ) : (
        <ExtensionDialogShell title={pending.title} onDismiss={() => dismiss(pending.id)}>
          <input
            className="mb-4 w-full rounded-md border px-3 py-2 text-[13px]"
            value={inputValue}
            placeholder={pending.placeholder}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-[13px]" onClick={() => dismiss(pending.id)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
              onClick={() => {
                respond({ id: pending.id, value: inputValue })
                setPending(null)
              }}
            >
              确定
            </button>
          </div>
        </ExtensionDialogShell>
      )}
    </>
  )
}