import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { QuestionnaireOptions } from './questionnaire-options'
import { QuestionnaireFooter } from './questionnaire-footer'
import {
  buildAnswers,
  chooseOption,
  clearDrafts,
  isAnswered,
  loadDrafts,
  saveDrafts,
  unansweredIndexes,
  type QuestionDraft,
  type QuestionnaireAnswer,
} from './questionnaire-model'
import './extension-ui.css'

export type AskQuestionPayload = {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string; hasPreview?: boolean; preview?: string }[]
}

type QuestionnaireDialogProps = {
  requestId: string
  questions: AskQuestionPayload[]
  onSubmit: (result: { cancelled: boolean; answers: QuestionnaireAnswer[] }) => void
  /** 遮罩 / X / Esc / 稍后：挂起，不 respond；草稿按 requestId 保留 */
  onSuspend: () => void
  /** 明确放弃并通知扩展取消 */
  onCancel: () => void
}

/** Pause after a single-choice click, so the pick is visible before the next question slides in. */
const AUTO_ADVANCE_MS = 240

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === 'text')
}

export function QuestionnaireDialog({ requestId, questions, onSubmit, onSuspend, onCancel }: QuestionnaireDialogProps) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => loadDrafts(requestId, questions.length))
  // Resuming a half-answered questionnaire starts at the first open question.
  const [tab, setTab] = useState(() => Math.max(0, unansweredIndexes(questions, drafts)[0] ?? 0))
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [notice, setNotice] = useState<string | null>(null)
  const [previewLabel, setPreviewLabel] = useState<string | undefined>()
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)

  useEffect(() => saveDrafts(requestId, drafts), [requestId, drafts])
  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])
  // Switching questions unmounts the focused option; pull focus back so the keys keep working.
  useEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
  }, [tab])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSuspend()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSuspend])

  const q = questions[tab]
  if (!q) return null
  const draft = drafts[tab]
  const isLast = tab >= questions.length - 1
  const multi = !!q.multiSelect
  const many = questions.length > 1

  const goTo = (index: number) => {
    window.clearTimeout(advanceTimer.current)
    if (index === tab || index < 0 || index >= questions.length) return
    setDirection(index > tab ? 'forward' : 'back')
    setTab(index)
    setNotice(null)
    setPreviewLabel(undefined)
  }

  const updateDraft = (next: QuestionDraft) => {
    setDrafts((current) => current.map((value, index) => (index === tab ? next : value)))
    setNotice(null)
  }

  const submit = () => {
    window.clearTimeout(advanceTimer.current)
    const open = unansweredIndexes(questions, drafts)
    if (open.length) {
      if (open[0] !== tab) goTo(open[0])
      setNotice(t('extension:qUnanswered', { count: open.length }))
      return
    }
    clearDrafts(requestId)
    onSubmit({ cancelled: false, answers: buildAnswers(questions, drafts) })
  }

  const next = () => (isLast ? submit() : goTo(tab + 1))

  const choose = (label: string) => {
    updateDraft(chooseOption(draft, label, multi))
    if (multi) return
    window.clearTimeout(advanceTimer.current)
    if (isLast) {
      primaryRef.current?.focus({ preventScroll: true })
      return
    }
    advanceTimer.current = window.setTimeout(() => goTo(tab + 1), AUTO_ADVANCE_MS)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || isTextField(event.target)) return
    if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey) {
      const option = q.options[Number(event.key) - 1]
      if (option) {
        event.preventDefault()
        choose(option.label)
      }
      return
    }
    // Enter on a focused option/button activates it; elsewhere it moves on.
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      next()
    }
  }

  const hasPreviewLayout = !multi && q.options.some((option) => typeof option.preview === 'string' && option.preview.length > 0)
  const previewOption =
    q.options.find((option) => option.label === (previewLabel ?? draft.selected[0])) ??
    q.options.find((option) => typeof option.preview === 'string' && option.preview)
  const previewText = typeof previewOption?.preview === 'string' && previewOption.preview ? previewOption.preview : undefined

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onSuspend()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`questionnaire-${requestId}-title`}
        className={cn(
          'overlay-panel relative flex max-h-[85vh] w-full flex-col rounded-xl border border-border bg-background shadow-xl outline-none',
          hasPreviewLayout ? 'max-w-4xl' : 'max-w-lg',
        )}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('extension:answerLater')}
          title={t('extension:answerLater')}
          onClick={onSuspend}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b px-5 pb-3.5 pt-4 pr-11">
          {many && (
            <nav className="mb-3 flex flex-wrap items-center gap-1.5" aria-label={t('extension:qSteps')}>
              {questions.map((question, index) => {
                const answered = isAnswered(drafts[index])
                return (
                  <button
                    key={index}
                    type="button"
                    aria-current={index === tab ? 'step' : undefined}
                    title={question.question}
                    // Keep focus on the panel so number keys and Enter keep working after a click.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo(index)}
                    className={cn(
                      'flex max-w-[11rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                      index === tab
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : answered
                          ? 'border-border/60 text-foreground/80 hover:bg-muted'
                          : 'border-dashed border-border/70 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {answered && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    <span className="truncate">{question.header || `${index + 1}`}</span>
                  </button>
                )
              })}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {tab + 1} / {questions.length}
              </span>
            </nav>
          )}
          {!many && q.header && (
            <span className="mb-1.5 inline-block rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{q.header}</span>
          )}
          <h2 id={`questionnaire-${requestId}-title`} className="text-[15px] font-medium leading-snug">
            {q.question}
          </h2>
          {multi && <p className="mt-1 text-[12px] text-muted-foreground">{t('extension:qMultiHint')}</p>}
        </div>

        <div
          key={tab}
          data-direction={direction}
          className={cn(
            'questionnaire-step min-h-0 overflow-y-auto px-5 py-4',
            hasPreviewLayout && 'grid grid-cols-1 gap-4 md:grid-cols-2',
          )}
        >
          <QuestionnaireOptions
            question={q}
            draft={draft}
            onChoose={choose}
            onChooseCustom={() => updateDraft({ ...draft, useCustom: true, selected: multi ? [] : draft.selected })}
            onCustomChange={(text) => updateDraft({ ...draft, custom: text, useCustom: true })}
            onPreview={setPreviewLabel}
            onCommit={next}
          />
          {hasPreviewLayout && (
            <div className="min-h-[120px] rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {t('extension:qPreview')}
              </div>
              {previewText ? (
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
                  {previewText}
                </pre>
              ) : (
                <p className="text-[12px] text-muted-foreground/60">{t('extension:qPreviewEmpty')}</p>
              )}
            </div>
          )}
          <p className="mt-3 hidden text-[11px] text-muted-foreground/55 sm:block md:col-span-2">
            {t(isLast ? 'extension:qKeysLast' : 'extension:qKeys')}
          </p>
        </div>

        <QuestionnaireFooter
          tab={tab}
          isLast={isLast}
          notice={notice}
          primaryRef={primaryRef}
          onPrevious={() => goTo(tab - 1)}
          onNext={() => goTo(tab + 1)}
          onSubmit={submit}
          onSuspend={onSuspend}
          onCancel={() => {
            clearDrafts(requestId)
            onCancel()
          }}
        />
      </div>
    </div>
  )
}
