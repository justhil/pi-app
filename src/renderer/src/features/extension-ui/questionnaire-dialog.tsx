import { useState } from 'react'
import { cn } from '@renderer/lib/utils'

export type AskQuestionPayload = {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string; hasPreview?: boolean }[]
}

type QuestionnaireDialogProps = {
  requestId: string
  questions: AskQuestionPayload[]
  onSubmit: (result: { cancelled: boolean; answers: unknown[] }) => void
  onCancel: () => void
}

export function QuestionnaireDialog({
  questions,
  onSubmit,
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

  if (!q) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-xl">
        <div className="border-b px-5 py-4">
          <div className="mb-1 flex gap-2 text-[11px] text-muted-foreground">
            {q.header && <span className="rounded bg-muted px-2 py-0.5">{q.header}</span>}
            <span>
              {tab + 1} / {questions.length}
            </span>
          </div>
          <h2 className="text-[15px] font-medium leading-snug">{q.question}</h2>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
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
                    'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left',
                    checked ? 'border-primary/50 bg-accent' : 'hover:bg-accent/40',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                      checked ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                    )}
                  />
                  <div>
                    <div className="text-[13px] font-medium">{opt.label}</div>
                    {opt.description && (
                      <div className="text-[12px] text-muted-foreground">{opt.description}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {!q.multiSelect && !q.options.some((o) => o.hasPreview) && (
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
          <button
            type="button"
            className="text-[13px] text-muted-foreground hover:text-foreground"
            onClick={() => onSubmit({ cancelled: true, answers: [] })}
          >
            取消
          </button>
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