import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type AskQuestionPayload = {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string; hasPreview?: boolean; preview?: string }[]
}

type QuestionnaireDialogProps = {
  requestId: string
  questions: AskQuestionPayload[]
  onSubmit: (result: { cancelled: boolean; answers: unknown[] }) => void
  /** 遮罩 / X / Esc / 稍后：挂起，不 respond */
  onSuspend: () => void
  /** 明确放弃并通知扩展取消 */
  onCancel: () => void
}

export function QuestionnaireDialog({
  questions,
  onSubmit,
  onSuspend,
  onCancel,
}: QuestionnaireDialogProps) {
  const [tab, setTab] = useState(0)
  const [singleChoice, setSingleChoice] = useState<Record<number, string>>({})
  const [multiChoice, setMultiChoice] = useState<Record<number, string[]>>({})
  const [customText, setCustomText] = useState<Record<number, string>>({})

  const q = questions[tab]
  const isLast = tab >= questions.length - 1

  const submitAll = () => {
    const answers = questions.map((question, questionIndex) => {
      const custom = customText[questionIndex]?.trim()
      if (custom) {
        return { questionIndex, question: question.question, kind: 'custom' as const, answer: custom }
      }
      if (question.multiSelect) {
        return {
          questionIndex,
          question: question.question,
          kind: 'multi' as const,
          answer: null,
          selected: multiChoice[questionIndex] || [],
        }
      }
      return {
        questionIndex,
        question: question.question,
        kind: 'option' as const,
        answer: singleChoice[questionIndex] || null,
      }
    })
    onSubmit({ cancelled: false, answers })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSuspend()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSuspend])

  if (!q) return null

  const hasPreviewLayout =
    !q.multiSelect && q.options.some((o) => typeof o.preview === 'string' && o.preview.length > 0)
  const selectedLabel = singleChoice[tab]
  const previewOpt = q.options.find((o) => o.label === selectedLabel)
  const previewText =
    typeof previewOpt?.preview === 'string' && previewOpt.preview.length > 0
      ? previewOpt.preview
      : q.options.find((o) => typeof o.preview === 'string' && o.preview)?.preview

  const optionList = (
    <div className="space-y-2">
      {q.options.map((opt) => {
        const checked = q.multiSelect
          ? (multiChoice[tab] || []).includes(opt.label)
          : singleChoice[tab] === opt.label
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => {
              if (q.multiSelect) {
                const prev = multiChoice[tab] || []
                setMultiChoice({
                  ...multiChoice,
                  [tab]: checked ? prev.filter((x) => x !== opt.label) : [...prev, opt.label],
                })
              } else {
                setSingleChoice({ ...singleChoice, [tab]: opt.label })
              }
            }}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              checked ? 'border-primary/50 bg-accent' : 'hover:bg-accent/40',
            )}
          >
            <span
              className={cn(
                'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                checked ? 'border-primary bg-primary' : 'border-muted-foreground/40',
              )}
            />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{opt.label}</div>
              {opt.description && (
                <div className="text-[12px] text-muted-foreground">{opt.description}</div>
              )}
              {opt.hasPreview && !opt.preview && (
                <div className="text-[10px] text-amber-600/80">含预览（选此项后右侧显示）</div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSuspend()
      }}
    >
      <div
        className={cn(
          'relative flex max-h-[85vh] flex-col rounded-xl border border-border bg-background shadow-xl',
          hasPreviewLayout ? 'w-full max-w-4xl' : 'w-full max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="稍后作答"
          onClick={onSuspend}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="border-b px-5 py-4 pr-10">
          <div className="mb-1 flex gap-2 text-[11px] text-muted-foreground">
            {q.header && <span className="rounded bg-muted px-2 py-0.5">{q.header}</span>}
            <span>
              {tab + 1} / {questions.length}
            </span>
          </div>
          <h2 className="text-[15px] font-medium leading-snug">{q.question}</h2>
        </div>

        <div
          className={cn(
            'max-h-[55vh] overflow-y-auto px-5 py-4',
            hasPreviewLayout && 'grid grid-cols-1 gap-4 md:grid-cols-2',
          )}
        >
          <div>{optionList}</div>
          {hasPreviewLayout && (
            <div className="min-h-[120px] rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                选项预览
              </div>
              {previewText ? (
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
                  {previewText}
                </pre>
              ) : (
                <p className="text-[12px] text-muted-foreground/60">选择左侧选项以查看预览内容</p>
              )}
            </div>
          )}
          {!hasPreviewLayout && !q.multiSelect && (
            <textarea
              className="mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
              rows={2}
              placeholder="自定义答案…"
              value={customText[tab] || ''}
              onChange={(e) => setCustomText({ ...customText, [tab]: e.target.value })}
            />
          )}
        </div>

        <div className="flex justify-between border-t px-5 py-3">
          <div className="flex gap-3">
            <button
              type="button"
              className="text-[13px] text-muted-foreground hover:text-foreground"
              onClick={onSuspend}
            >
              稍后作答
            </button>
            <button
              type="button"
              className="text-[13px] text-destructive/80 hover:text-destructive"
              onClick={onCancel}
            >
              取消并通知扩展
            </button>
          </div>
          <div className="flex gap-2">
            {tab > 0 && (
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-[13px]"
                onClick={() => setTab(tab - 1)}
              >
                上一题
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
                onClick={() => setTab(tab + 1)}
              >
                下一题
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
                onClick={submitAll}
              >
                提交
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}