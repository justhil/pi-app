import { useEffect, useState, type ReactNode } from 'react'
import { toast, Toaster } from 'sonner'
import { onExtensionUIRequest, ipcClient } from '@renderer/lib/ipc-client'
import { QuestionnaireDialog, type AskQuestionPayload } from './questionnaire-dialog'

type PendingUI =
  | { id: string; method: 'ask_user_question'; questions: AskQuestionPayload[] }
  | { id: string; method: 'select'; title: string; options: string[] }
  | { id: string; method: 'confirm'; title: string; message: string }
  | { id: string; method: 'input'; title: string; placeholder?: string }

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
        setPending({
          id,
          method: 'ask_user_question',
          questions: (req.questions as AskQuestionPayload[]) || [],
        })
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
        setPending({
          id,
          method: 'confirm',
          title: req.title as string,
          message: req.message as string,
        })
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

  const overlay = (children: ReactNode) => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">{children}</div>
    </div>
  )

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
          onCancel={() => {
            respond({ id: pending.id, cancelled: true })
            setPending(null)
          }}
        />
      ) : pending.method === 'image_review' ? (
        <ImageReviewDialog
          payload={pending.payload}
          onCancel={() => {
            respond({ id: pending.id, cancelled: true })
            setPending(null)
          }}
          onSubmit={(r) => {
            respond({ id: pending.id, result: r })
            setPending(null)
          }}
        />
      ) : pending.method === 'select' ? (
        overlay(
          <>
            <h2 className="mb-3 text-[15px] font-medium">{pending.title}</h2>
            <div className="flex flex-col gap-1">
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
          </>,
        )
      ) : pending.method === 'confirm' ? (
        overlay(
          <>
            <h2 className="mb-2 text-[15px] font-medium">{pending.title}</h2>
            <p className="mb-4 text-[13px] text-muted-foreground">{pending.message}</p>
            <div className="flex justify-end gap-2">
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
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
                onClick={() => {
                  respond({ id: pending.id, confirmed: true })
                  setPending(null)
                }}
              >
                是
              </button>
            </div>
          </>,
        )
      ) : (
        overlay(
          <>
            <h2 className="mb-3 text-[15px] font-medium">{pending.title}</h2>
            <input
              className="mb-4 w-full rounded-md border px-3 py-2 text-[13px]"
              value={inputValue}
              placeholder={pending.placeholder}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <div className="flex justify-end">
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
          </>,
        )
      )}
    </>
  )
}