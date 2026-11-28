import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import i18n from '@renderer/lib/i18n'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize2,
  MessageCircleQuestion,
  X,
} from '@renderer/components/icons'
import { AnimatedHeight } from '@renderer/components/ui/animated-height'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  clearExtensionToolRowFlags,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import {
  buildAnswers,
  clearDrafts,
  isAnswered,
  loadActiveTab,
  loadDrafts,
  parseOptionRecommendation,
  saveActiveTab,
  saveDrafts,
  type QuestionDraft,
} from './questionnaire-model'
import { QuestionnaireOptions } from './questionnaire-options'
import { QuestionnaireCountdownBadge } from './questionnaire-countdown-badge'
import { looksLikeAsciiDiagram, QuestionnaireMarkdown } from './questionnaire-markdown'
import type { AskQuestionPayload } from './questionnaire-dialog'
import './extension-ui.css'

const AUTO_ADVANCE_MS = 110

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"], [role="dialog"], [aria-modal="true"]'))
  )
}

function findRunningToolContext(): { toolCallId?: string; toolName?: string; timelineItemId?: string } {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'tool-call' && (it.toolPhase === 'start' || it.toolPhase === 'update')) {
      return { toolCallId: it.toolCallId, toolName: it.toolName, timelineItemId: it.id }
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

export function ComposerInlineQuestionnaire() {
  const setInlineHostMounted = useExtensionUIStore((s) => s.setInlineHostMounted)
  const activePending = useExtensionUIStore((s) => s.activePending)
  const expandedModal = useExtensionUIStore((s) => s.inlineQuestionnaireExpandedModal)
  const historySessionFile = useUIStore((s) => s.historySessionFile)

  useEffect(() => {
    setInlineHostMounted(true)
    return () => setInlineHostMounted(false)
  }, [setInlineHostMounted])

  if (!activePending || activePending.method !== 'ask_user_question' || expandedModal) {
    return null
  }
  if (
    activePending.sessionFile &&
    historySessionFile &&
    !sessionFilesEqual(activePending.sessionFile, historySessionFile)
  ) {
    return null
  }

  return (
    <InlineQuestionnaireCard
      key={activePending.id}
      requestId={activePending.id}
      questions={activePending.questions}
      deadlineAt={activePending.deadlineAt}
      timeoutMs={activePending.timeoutMs}
    />
  )
}

function InlineQuestionnaireCard({
  requestId,
  questions,
  deadlineAt,
  timeoutMs,
}: {
  requestId: string
  questions: AskQuestionPayload[]
  deadlineAt?: number
  timeoutMs?: number
}) {
  const { t } = useTranslation()
  const clearAfterRespond = useExtensionUIStore((s) => s.clearAfterRespond)
  const setExpandedModal = useExtensionUIStore((s) => s.setInlineQuestionnaireExpandedModal)

  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState(() => loadActiveTab(requestId, questions.length) ?? 0)
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => loadDrafts(requestId, questions.length, questions))
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(undefined)
  const [previewCopied, setPreviewCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const advanceTimer = useRef<number | null>(null)

  const q = questions[tab]
  const draft = drafts[tab] ?? { selected: [], custom: '', useCustom: false }
  const many = questions.length > 1
  const multi = Boolean(q?.multiSelect)
  const answeredCount = drafts.filter(isAnswered).length
  const totalOptionRows = (q?.options.length ?? 0) + (q && q.options.length > 0 ? 1 : 0)

  useEffect(() => {
    saveDrafts(requestId, drafts)
  }, [requestId, drafts])

  useEffect(() => {
    saveActiveTab(requestId, tab)
  }, [requestId, tab])

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    },
    [],
  )

  const submitAll = (latestDrafts: QuestionDraft[] = drafts) => {
    const missing = latestDrafts.findIndex((d) => !isAnswered(d))
    if (missing >= 0) {
      setTab(missing)
      setFocusedIndex(-1)
      setNotice(
        t('extension:qUnanswered', {
          count: latestDrafts.filter((d) => !isAnswered(d)).length,
        }),
      )
      return
    }
    const result = { cancelled: false, answers: buildAnswers(questions, latestDrafts) }
    clearDrafts(requestId)
    const { timelineItemId } = findRunningToolContext()
    void ipcClient.invoke('extension.respondUI', { id: requestId, result }).catch(() => {})
    clearExtensionToolRowFlags(timelineItemId)
    clearAfterRespond()
  }

  const suspendCard = () => {
    saveDrafts(requestId, drafts)
    saveActiveTab(requestId, tab)
    const meta = findRunningToolContext()
    useExtensionUIStore.getState().suspendActive(meta)
    if (meta.timelineItemId) {
      useUIStore.getState().updateTimelineItem(meta.timelineItemId, {
        extensionUiSuspended: true,
        toolStatusLine: i18n.t('extension:waitingAnswer'),
      })
    }
    toast.message(i18n.t('extension:suspendedToast'))
  }

  const cancelAll = () => {
    clearDrafts(requestId)
    const { timelineItemId } = findRunningToolContext()
    void ipcClient.invoke('extension.respondUI', { id: requestId, cancelled: true }).catch(() => {})
    clearExtensionToolRowFlags(timelineItemId)
    clearAfterRespond()
    reconcileStaleInteractiveToolRows(requestId)
  }

  const updateCurrentDraft = (next: QuestionDraft) => {
    setDrafts((prev) => prev.map((d, i) => (i === tab ? next : d)))
    setNotice(null)
  }

  const goTo = (index: number) => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
    setTab(index)
    setFocusedIndex(-1)
    setPreviewLabel(undefined)
    setNotice(null)
  }

  const chooseOption = (label: string) => {
    if (!q) return
    if (multi) {
      const exists = draft.selected.includes(label)
      const nextSel = exists ? draft.selected.filter((x: string) => x !== label) : [...draft.selected, label]
      updateCurrentDraft({ ...draft, selected: nextSel, useCustom: false })
      return
    }
    const nextDraft: QuestionDraft = { ...draft, selected: [label], useCustom: false }
    const nextAll = drafts.map((d, i) => (i === tab ? nextDraft : d))
    setDrafts(nextAll)
    setNotice(null)
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null
      if (tab < questions.length - 1) {
        goTo(tab + 1)
      } else {
        submitAll(nextAll)
      }
    }, AUTO_ADVANCE_MS)
  }

  useEffect(() => {
    if (collapsed || !q) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submitAll()
        return
      }
      if (isEditableTarget(e.target)) return
      if (totalOptionRows > 0 && e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIdx = focusedIndex < 0 ? 0 : (focusedIndex + 1) % totalOptionRows
        setFocusedIndex(nextIdx)
        if (nextIdx < q.options.length) setPreviewLabel(q.options[nextIdx].label)
        return
      }
      if (totalOptionRows > 0 && e.key === 'ArrowUp') {
        e.preventDefault()
        const prevIdx =
          focusedIndex < 0
            ? totalOptionRows - 1
            : (focusedIndex - 1 + totalOptionRows) % totalOptionRows
        setFocusedIndex(prevIdx)
        if (prevIdx < q.options.length) setPreviewLabel(q.options[prevIdx].label)
        return
      }
      if (e.key === 'ArrowLeft' && many && tab > 0) {
        e.preventDefault()
        goTo(tab - 1)
        return
      }
      if (e.key === 'ArrowRight' && many && tab < questions.length - 1) {
        e.preventDefault()
        goTo(tab + 1)
        return
      }
      if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const idx = Number(e.key) - 1
        const opt = q.options[idx]
        if (opt) {
          e.preventDefault()
          setFocusedIndex(idx)
          chooseOption(opt.label)
        }
        return
      }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        if (!isAnswered(draft) && focusedIndex >= 0 && focusedIndex < q.options.length) {
          chooseOption(q.options[focusedIndex].label)
        } else if (!isAnswered(draft) && focusedIndex === q.options.length && q.options.length > 0) {
          updateCurrentDraft({ ...draft, useCustom: true, selected: multi ? [] : draft.selected })
        } else if (tab < questions.length - 1) {
          goTo(tab + 1)
        } else {
          submitAll()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!q) return null

  const activePreviewOption =
    q.options.find((o) => o.label === previewLabel) ||
    q.options.find((o) => draft.selected.includes(o.label)) ||
    q.options.find((o) => parseOptionRecommendation(o.label, q.recommended).isRecommended && o.preview) ||
    q.options.find((o) => typeof o.preview === 'string' && o.preview.trim().length > 0)

  const activePreview = !multi && !draft.useCustom ? activePreviewOption?.preview : undefined
  const activePreviewTitle = activePreviewOption
    ? parseOptionRecommendation(activePreviewOption.label, q.recommended).displayLabel
    : undefined

  const copyPreview = () => {
    if (!activePreview) return
    void navigator.clipboard.writeText(activePreview).then(() => {
      setPreviewCopied(true)
      window.setTimeout(() => setPreviewCopied(false), 1400)
    })
  }

  return (
    <section
      data-pi-slot="composer-inline-question"
      className="composer-inline-question-shell pointer-events-auto mb-2 overflow-hidden"
    >
      {/* Unified single-row workbench header: inline step tabs when expanded, summary trigger when collapsed */}
      <div
        className={cn(
          'composer-inline-question-bar flex min-h-[34px] items-center justify-between gap-2 px-3 py-1',
          !collapsed && 'border-b border-border/55',
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-foreground-secondary transition-colors hover:text-foreground"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 opacity-75" />
            <span className="shrink-0 text-[12px] font-medium text-foreground">
              {q.header || t('extension:resumeWaitingAnswer')}
            </span>
            {many && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {answeredCount}/{questions.length}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              <span className="mx-1 opacity-45">·</span>
              {q.question}
            </span>
          </button>
        ) : many ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <MessageCircleQuestion className="mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {questions.map((item, idx) => {
              const done = isAnswered(drafts[idx] ?? { selected: [], custom: '', useCustom: false })
              const active = idx === tab
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => goTo(idx)}
                  className={cn(
                    'inline-flex h-6 max-w-[10.5rem] shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors',
                    active
                      ? 'bg-[var(--bg-base)] font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-border/75'
                      : 'text-muted-foreground hover:bg-[var(--bg-hover)]/75 hover:text-foreground',
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3 shrink-0 text-[var(--success-semantic,#16a34a)]" strokeWidth={2.2} />
                  ) : (
                    <span className="font-mono text-[10.5px] opacity-60">{idx + 1}.</span>
                  )}
                  <span className="truncate">{item.header || `#${idx + 1}`}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground-secondary hover:text-foreground"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 opacity-75" />
            <span className="truncate text-[12px] font-medium text-foreground">
              {q.header || t('extension:resumeWaitingAnswer')}
            </span>
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <QuestionnaireCountdownBadge deadlineAt={deadlineAt} timeoutMs={timeoutMs} compact />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <span>
              {collapsed
                ? t('common:github.inlineQuestionExpand')
                : t('common:github.inlineQuestionCollapse')}
            </span>
            <ChevronDown className={cn('h-3 w-3 opacity-70 transition-transform', !collapsed && 'rotate-180')} />
          </button>
          <button
            type="button"
            title={t('extension:qExpandToModal')}
            aria-label={t('extension:qExpandToModal')}
            onClick={() => {
              saveDrafts(requestId, drafts)
              saveActiveTab(requestId, tab)
              setExpandedModal(true)
            }}
            className="chrome-icon-btn inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            title={t('extension:cancel')}
            aria-label={t('extension:cancel')}
            onClick={cancelAll}
            className="chrome-icon-btn inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatedHeight>
        {!collapsed ? (
          <div className="flex flex-col">
            <div className="studio-thin-scroll max-h-[42vh] overflow-y-auto px-3.5 py-3">
              {/* Question title row */}
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13px] font-medium leading-[1.45] text-foreground">
                  <QuestionnaireMarkdown content={q.question} compact plainHeadings />
                </div>
                {multi && (
                  <span className="shrink-0 rounded border border-border/65 bg-[var(--bg-1)] px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                    {t('extension:qMultiHint')}
                  </span>
                )}
              </div>

              {/* Auto 2-column split on >=540px wide chat column when option carries preview */}
              <div
                className="composer-inline-question-split"
                data-has-preview={activePreview ? 'true' : undefined}
              >
                <QuestionnaireOptions
                  question={q}
                  draft={draft}
                  compact
                  focusedIndex={focusedIndex}
                  onChoose={(lbl) => {
                    const idx = q.options.findIndex((o) => o.label === lbl)
                    if (idx >= 0) setFocusedIndex(idx)
                    chooseOption(lbl)
                  }}
                  onChooseCustom={() => {
                    setFocusedIndex(q.options.length)
                    updateCurrentDraft({ ...draft, useCustom: true, selected: multi ? [] : draft.selected })
                  }}
                  onCustomChange={(text) => updateCurrentDraft({ ...draft, custom: text, useCustom: true })}
                  onPreview={(lbl) => {
                    const idx = q.options.findIndex((o) => o.label === lbl)
                    if (idx >= 0) setFocusedIndex(idx)
                    setPreviewLabel(lbl)
                  }}
                  onCommit={() => {
                    if (tab < questions.length - 1) goTo(tab + 1)
                    else submitAll()
                  }}
                />

                {activePreview && (
                  <div className="flex min-w-0 flex-col overflow-hidden rounded-[9px] border border-border/60 bg-[var(--bg-1)]/75">
                    <div className="flex items-center justify-between gap-2 border-b border-border/45 px-2.5 py-1 text-[10.5px] text-muted-foreground">
                      <span className="truncate font-medium">
                        {t('extension:qPreview')}
                        {activePreviewTitle ? (
                          <span className="ml-1 font-normal text-foreground-secondary">· {activePreviewTitle}</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={copyPreview}
                        title={t('extension:qPreviewCopy')}
                        aria-label={t('extension:qPreviewCopy')}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        {previewCopied ? (
                          <Check className="h-2.5 w-2.5 text-[var(--success-semantic,#16a34a)]" />
                        ) : (
                          <Copy className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </div>
                    <div className="studio-thin-scroll max-h-[210px] overflow-auto p-2.5 text-[12px]">
                      {looksLikeAsciiDiagram(activePreview) ? (
                        <pre className="overflow-x-auto font-mono text-[11px] leading-[1.45] text-foreground/90">
                          {activePreview}
                        </pre>
                      ) : (
                        <QuestionnaireMarkdown content={activePreview} compact plainHeadings />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {notice && (
                <div className="mt-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  {notice}
                </div>
              )}
            </div>

            {/* Footer aligned with Composer toolbar ink primary buttons & quiet secondary controls */}
            <div className="composer-inline-question-bar flex items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={suspendCard}
                  className="shrink-0 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('extension:answerLater')}
                </button>
                <span className="hidden truncate text-muted-foreground/65 sm:inline">
                  · {many ? `${answeredCount}/${questions.length} · ` : ''}
                  {t(tab === questions.length - 1 ? 'extension:qKeysLast' : 'extension:qKeys')}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {many && tab > 0 && (
                  <button
                    type="button"
                    onClick={() => goTo(tab - 1)}
                    className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border/80 bg-[var(--bg-base)] px-2 text-[11.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    <span>{t('extension:qPrevious')}</span>
                  </button>
                )}
                {many && tab < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => goTo(tab + 1)}
                    className="inline-flex h-7 items-center gap-0.5 rounded-md bg-foreground px-2.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90"
                  >
                    <span>{t('extension:qNext')}</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => submitAll()}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-3 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.2} />
                    <span>{t('extension:qSubmit')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </AnimatedHeight>
    </section>
  )
}
