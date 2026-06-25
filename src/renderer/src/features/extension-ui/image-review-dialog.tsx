// Desktop image_review dialog (替代 pi-image-gen TUI showReviewOverlay).
// Renders when Worker emits custom kind=image_review: image preview + options + feedback.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { Image as ImageIcon, X } from 'lucide-react'

export interface ImageReviewPayload {
  image: string
  title: string
  question: string
  context?: string
  options: string[]
  allowFeedback: boolean
}

export interface ImageReviewResult {
  choice: string // option label
  label?: string
  feedback?: string
}

export function ImageReviewDialog({
  payload,
  onSuspend,
  onCancel,
  onSubmit,
}: {
  payload: ImageReviewPayload
  onSuspend: () => void
  onCancel: () => void
  onSubmit: (r: ImageReviewResult) => void
}) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [previewErr, setPreviewErr] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')

  const isUrl = /^https?:\/\//i.test(payload.image) || payload.image.startsWith('data:')

  useEffect(() => {
    if (isUrl) {
      setSrc(payload.image)
      return
    }
    let cancelled = false
    ipcClient
      .invoke('shell.readImagePreview', { path: payload.image })
      .then((res) => {
        if (cancelled) return
        if (res?.ok && res.dataUrl) setSrc(res.dataUrl)
        else setPreviewErr(true)
      })
      .catch(() => { if (!cancelled) setPreviewErr(true) })
    return () => { cancelled = true }
  }, [payload.image, isUrl])

  const CHOICE_ENUM = ['approve', 'revise', 'reject', 'cancel'] as const

  const choose = (label: string, index: number) => {
    setSelected(label)
    setSelectedIndex(index)
  }

  const submit = () => {
    const idx = selectedIndex ?? 0
    const label = selected || payload.options[0]
    const choice = CHOICE_ENUM[idx] ?? 'approve'
    onSubmit({ choice, label, feedback: payload.allowFeedback ? feedback : undefined })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSuspend()
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-pink-500" />
            <span className="text-[13px] font-semibold">{payload.title}</span>
          </div>
          <button type="button" onClick={onSuspend} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={t('extension:answerLater')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="text-[13px] font-medium text-foreground/90">{payload.question}</div>
          {payload.context && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-[11px] text-muted-foreground">
              {payload.context}
            </div>
          )}

          <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-border/50 bg-muted/20 p-2">
            {previewErr && (
              <div className="text-center text-[11px] text-muted-foreground/60">
                {t('extension:cannotPreview')}
                <div className="mt-1 font-mono text-[10px]">{payload.image.split(/[\\/]/).pop()}</div>
              </div>
            )}
            {!previewErr && !src && <div className="h-32 w-full animate-pulse rounded-md bg-muted/40" />}
            {src && <img src={src} alt="" className="max-h-[320px] max-w-full rounded-md object-contain" />}
          </div>

          <div className="flex flex-wrap gap-2">
            {payload.options.map((opt, i) => (
              <button
                key={opt}
                onClick={() => choose(opt, i)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-[12px] transition-all duration-motion-fast ease-motion-ease active:scale-[0.97]',
                  selected === opt
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground/80 hover:bg-muted',
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          {payload.allowFeedback && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t('extension:feedbackOptional')}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
              rows={2}
            />
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-border/60 px-4 py-2.5">
          <div className="flex gap-2">
            <button type="button" onClick={onSuspend} className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted">
              {t('extension:answerLater')}
            </button>
            <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted">
              {t('extension:cancel')}
            </button>
          </div>
          <button
            onClick={submit}
            disabled={!selected}
            className="rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            提交
          </button>
        </div>
      </div>
    </div>
  )
}
