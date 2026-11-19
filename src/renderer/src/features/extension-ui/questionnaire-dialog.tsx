import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Eye, FileCode, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { QuestionnaireFooter } from './questionnaire-footer'
import {
  hasRichMarkdownSyntax,
  looksLikeAsciiDiagram,
  QuestionnaireMarkdown,
} from './questionnaire-markdown'
import {
  buildAnswers,
  chooseOption,
  clearDrafts,
  isAnswered,
  loadDrafts,
  saveDrafts,
  unansweredIndexes,
  type QuestionDraft,
} from './questionnaire-model'
import { QuestionnaireOptions } from './questionnaire-options'
import './extension-ui.css'

export type AskQuestionOption = {
  label: string
  description?: string
  preview?: string
}

export type AskQuestionPayload = {
  question: string
  header?: string
  options: AskQuestionOption[]
  multiSelect?: boolean
}

export type AskQuestionAnswer = {
  questionIndex: number
  question: string
  kind: 'option' | 'multi' | 'custom'
  answer: string | null
  selected?: string[]
}

export type QuestionnaireResult = {
  cancelled: boolean
  answers: AskQuestionAnswer[]
}

/** Brief pause after a single-choice pick so the check animation reads before the slide. */
const AUTO_ADVANCE_MS = 180

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement

export function QuestionnaireDialog({
  requestId,
  questions,
  onSubmit,
  onSuspend,
  onCancel,
}: {
  requestId: string
  questions: AskQuestionPayload[]
  onSubmit: (result: QuestionnaireResult) => void
  onSuspend: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => loadDrafts(requestId, questions.length))
  const [tab, setTab] = useState(
    () => unansweredIndexes(questions, loadDrafts(requestId, questions.length))[0] ?? 0,
  )
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [notice, setNotice] = useState<string | null>(null)
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(undefined)
  const [previewModeOverride, setPreviewModeOverride] = useState<'markdown' | 'raw' | null>(null)
  const [previewCopied, setPreviewCopied] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    saveDrafts(requestId, drafts)
  }, [requestId, drafts])

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
    setPreviewModeOverride(null)
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

  const hasPreviewLayout =
    !multi && q.options.some((option) => typeof option.preview === 'string' && option.preview.length > 0)
  const previewOption =
    q.options.find((option) => option.label === (previewLabel ?? draft.selected[0])) ??
    q.options.find((option) => typeof option.preview === 'string' && option.preview)
  const previewText =
    typeof previewOption?.preview === 'string' && previewOption.preview ? previewOption.preview : undefined

  const questionHasRichLayout = hasRichMarkdownSyntax(q.question) || q.question.includes('\n')
  const hasLongContent =
    questionHasRichLayout ||
    q.question.length > 140 ||
    q.options.some((o) => (o.description?.length ?? 0) > 110 || (o.description?.includes('\n') ?? false))

  const defaultPreviewMode: 'markdown' | 'raw' =
    previewText && looksLikeAsciiDiagram(previewText) ? 'raw' : 'markdown'
  const effectivePreviewMode = previewModeOverride ?? defaultPreviewMode
  // In preview layout, typing a custom answer expands options/editor across the full dialog width.
  const expandCustomFullWidth = hasPreviewLayout && draft.useCustom

  const copyPreview = () => {
    if (!previewText) return
    void navigator.clipboard.writeText(previewText).then(() => {
      setPreviewCopied(true)
      window.setTimeout(() => setPreviewCopied(false), 1500)
    })
  }

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
          'overlay-panel relative flex max-h-[86vh] w-full flex-col rounded-xl border border-border bg-background shadow-xl outline-none',
          hasPreviewLayout ? 'max-w-5xl' : hasLongContent ? 'max-w-2xl' : 'max-w-xl',
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

        <div className="shrink-0 border-b px-5 pb-3.5 pt-4 pr-11">
          {many && (
            <nav
              className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5"
              aria-label={t('extension:qSteps')}
            >
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
                      'flex max-w-[11rem] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
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
              <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">
                {tab + 1} / {questions.length}
              </span>
            </nav>
          )}
          {!many && q.header && (
            <span className="mb-1.5 inline-block rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {q.header}
            </span>
          )}
          <div className="max-h-[30vh] overflow-y-auto pr-1" data-independent-scroll>
            {questionHasRichLayout ? (
              <div
                id={`questionnaire-${requestId}-title`}
                role="heading"
                aria-level={2}
                className="text-[14.5px] font-medium leading-snug text-foreground"
              >
                <QuestionnaireMarkdown content={q.question} plainHeadings className="text-[14px]" />
              </div>
            ) : (
              <h2
                id={`questionnaire-${requestId}-title`}
                className="break-words [overflow-wrap:anywhere] text-[15px] font-medium leading-snug"
              >
                {q.question}
              </h2>
            )}
          </div>
          {multi && <p className="mt-1 text-[12px] text-muted-foreground">{t('extension:qMultiHint')}</p>}
        </div>

        <div
          key={tab}
          data-direction={direction}
          className={cn(
            'questionnaire-step flex min-h-0 flex-1 flex-col px-5 py-4',
            !hasPreviewLayout || expandCustomFullWidth ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        >
          <div
            className={cn(
              hasPreviewLayout && !expandCustomFullWidth
                ? 'grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(260px,2fr)_minmax(0,3fr)]'
                : 'min-h-0',
            )}
          >
            <div
              className={cn(
                hasPreviewLayout && !expandCustomFullWidth && 'min-h-0 overflow-y-auto pr-1',
              )}
              data-independent-scroll
            >
              <QuestionnaireOptions
                question={q}
                draft={draft}
                wideCustom={expandCustomFullWidth}
                onChoose={choose}
                onChooseCustom={() =>
                  updateDraft({ ...draft, useCustom: true, selected: multi ? [] : draft.selected })
                }
                onCustomChange={(text) => updateDraft({ ...draft, custom: text, useCustom: true })}
                onPreview={(lbl) => {
                  setPreviewLabel(lbl)
                  setPreviewModeOverride(null)
                }}
                onCommit={next}
              />
            </div>

            {hasPreviewLayout && !expandCustomFullWidth && (
              <div className="flex min-h-[160px] min-w-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
                  <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
                    <span>{t('extension:qPreview')}</span>
                    {previewOption?.label ? (
                      <span className="ml-1.5 text-foreground/80">· {previewOption.label}</span>
                    ) : null}
                  </div>
                  {previewText && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewModeOverride(effectivePreviewMode === 'markdown' ? 'raw' : 'markdown')
                        }
                        title={
                          effectivePreviewMode === 'markdown'
                            ? t('extension:qPreviewRaw')
                            : t('extension:qPreviewRendered')
                        }
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {effectivePreviewMode === 'markdown' ? (
                          <>
                            <FileCode className="h-3 w-3" />
                            <span>{t('extension:qPreviewRaw')}</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            <span>{t('extension:qPreviewRendered')}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={copyPreview}
                        title={t('extension:qPreviewCopy')}
                        aria-label={t('extension:qPreviewCopy')}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {previewCopied ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-3" data-independent-scroll>
                  {previewText ? (
                    effectivePreviewMode === 'markdown' ? (
                      <QuestionnaireMarkdown content={previewText} compact className="text-[12.5px]" />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-foreground/90">
                        {previewText}
                      </pre>
                    )
                  ) : (
                    <p className="text-[12px] text-muted-foreground/60">{t('extension:qPreviewEmpty')}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 hidden shrink-0 text-[11px] text-muted-foreground/55 sm:block">
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
