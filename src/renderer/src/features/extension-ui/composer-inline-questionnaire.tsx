import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MessageSquare,
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
  loadDrafts,
  saveDrafts,
  type QuestionDraft,
} from './questionnaire-model'
import { QuestionnaireOptions } from './questionnaire-options'
import { QuestionnaireMarkdown } from './questionnaire-markdown'
import type { AskQuestionPayload } from './questionnaire-dialog'

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

function findRunningToolTimelineId(): string | undefined {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'tool-call' && (it.toolPhase === 'start' || it.toolPhase === 'update')) {
      return it.id
    }
  }
  return useExtensionUIStore.getState().suspended?.timelineItemId
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
    />
  )
}

function InlineQuestionnaireCard({
  requestId,
  questions,
}: {
  requestId: string
  questions: AskQuestionPayload[]
}) {
  const { t } = useTranslation()
  const clearAfterRespond = useExtensionUIStore((s) => s.clearAfterRespond)
  const setExpandedModal = useExtensionUIStore((s) => s.setInlineQuestionnaireExpandedModal)

  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState(0)
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => loadDrafts(requestId, questions.length))
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const advanceTimer = useRef<number | null>(null)

  const q = questions[tab]
  const draft = drafts[tab] ?? { selected: [], custom: '', useCustom: false }
  const many = questions.length > 1
  const multi = Boolean(q?.multiSelect)
  const answeredCount = drafts.filter(isAnswered).length
  const totalOptionRows = (q?.options.length ?? 0) + 1

  useEffect(() => {
    saveDrafts(requestId, drafts)
  }, [requestId, drafts])

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
    const tid = findRunningToolTimelineId()
    void ipcClient.invoke('extension.respondUI', { id: requestId, result }).catch(() => {})
    clearExtensionToolRowFlags(tid)
    clearAfterRespond()
  }

  const cancelAll = () => {
    clearDrafts(requestId)
    const tid = findRunningToolTimelineId()
    void ipcClient.invoke('extension.respondUI', { id: requestId, cancelled: true }).catch(() => {})
    clearExtensionToolRowFlags(tid)
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
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIdx = focusedIndex < 0 ? 0 : (focusedIndex + 1) % totalOptionRows
        setFocusedIndex(nextIdx)
        if (nextIdx < q.options.length) setPreviewLabel(q.options[nextIdx].label)
        return
      }
      if (e.key === 'ArrowUp') {
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
        } else if (!isAnswered(draft) && focusedIndex === q.options.length) {
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

  const activePreview =
    q.options.find((o) => o.label === previewLabel)?.preview ||
    q.options.find((o) => draft.selected.includes(o.label))?.preview

  return (
    <div
      data-pi-slot="composer-inline-question"
      className="pointer-events-auto mb-2 overflow-hidden rounded-xl border border-[var(--brand)]/35 bg-background/95 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/55 bg-[var(--brand)]/[0.045] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          <span className="truncate text-[12px] font-semibold text-foreground">
            {q.header || t('extension:resumeWaitingAnswer')}
          </span>
          {many && (
            <span className="shrink-0 rounded-full bg-[var(--brand)]/12 px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--brand)]">
              {tab + 1}/{questions.length}
            </span>
          )}
          {collapsed && (
            <span className="truncate text-[11.5px] text-muted-foreground">— {q.question}</span>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <span>
              {collapsed
                ? t('common:github.inlineQuestionExpand')
                : t('common:github.inlineQuestionCollapse')}
            </span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', !collapsed && 'rotate-180')} />
          </button>
          <button
            type="button"
            title={t('extension:confirm')}
            aria-label="Expand dialog"
            onClick={() => setExpandedModal(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            title={t('extension:cancel')}
            aria-label={t('extension:cancel')}
            onClick={cancelAll}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatedHeight>
        {!collapsed ? (
          <div className="flex flex-col">
            {many && (
              <div className="flex flex-wrap gap-1 border-b border-border/45 px-3 py-1.5">
                {questions.map((item, idx) => {
                  const done = isAnswered(drafts[idx] ?? { selected: [], custom: '', useCustom: false })
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => goTo(idx)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors',
                        idx === tab
                          ? 'bg-[var(--brand)]/12 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
                      )}
                    >
                      {done && <Check className="h-3 w-3 text-emerald-500" />}
                      <span>{item.header || `#${idx + 1}`}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="studio-thin-scroll max-h-[38vh] overflow-y-auto px-3.5 py-2.5">
              <div className="mb-2 text-[13px] font-medium leading-snug text-foreground">
                <QuestionnaireMarkdown content={q.question} compact plainHeadings />
              </div>

              <QuestionnaireOptions
                question={q}
                draft={draft}
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
                <div className="mt-2 rounded-lg border border-border/65 bg-[var(--bg-1)]/55 p-2.5 font-mono text-[11.5px]">
                  <QuestionnaireMarkdown content={activePreview} compact />
                </div>
              )}

              {notice && (
                <div className="mt-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  {notice}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/50 bg-[var(--bg-1)]/35 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                {many ? `${answeredCount}/${questions.length} · ` : ''}
                {t(tab === questions.length - 1 ? 'extension:qKeysLast' : 'extension:qKeys')}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                {many && tab > 0 && (
                  <button
                    type="button"
                    onClick={() => goTo(tab - 1)}
                    className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border px-2 text-[11.5px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    <span>{t('extension:qPrevious')}</span>
                  </button>
                )}
                {many && tab < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => goTo(tab + 1)}
                    className="inline-flex h-7 items-center gap-0.5 rounded-md bg-[var(--brand)] px-2.5 text-[11.5px] font-medium text-white hover:opacity-90"
                  >
                    <span>{t('extension:qNext')}</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => submitAll()}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--brand)] px-3 text-[11.5px] font-medium text-white hover:opacity-90"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>{t('extension:qSubmit')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </AnimatedHeight>
    </div>
  )
}
