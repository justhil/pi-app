import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { AskQuestionPayload } from './questionnaire-dialog'
import { hasRichMarkdownSyntax, QuestionnaireMarkdown } from './questionnaire-markdown'
import { parseOptionRecommendation, type QuestionDraft } from './questionnaire-model'

const LONG_DESC_CHAR_LIMIT = 220
const LONG_DESC_LINE_LIMIT = 4

type QuestionnaireOptionsProps = {
  question: AskQuestionPayload
  draft: QuestionDraft
  focusedIndex?: number
  /** Compact density for inline card above Composer. */
  compact?: boolean
  /** When true (preview layout + custom selected), expand custom textarea generously. */
  wideCustom?: boolean
  onChoose: (label: string) => void
  onChooseCustom: () => void
  onCustomChange: (text: string) => void
  onPreview: (label: string) => void
  /** Ctrl/⌘+Enter inside the custom answer. */
  onCommit: () => void
}

function Indicator({ checked, multi, compact }: { checked: boolean; multi: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        'questionnaire-indicator flex shrink-0 items-center justify-center border',
        compact ? 'mt-[2px] h-3.5 w-3.5' : 'mt-[3px] h-4 w-4',
        multi ? 'rounded-[4px]' : 'rounded-full',
        checked
          ? 'border-foreground bg-foreground text-background'
          : 'border-border/90 bg-[var(--bg-base)]',
      )}
      aria-hidden
    >
      {checked &&
        (multi ? (
          <Check className={cn('questionnaire-check', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} strokeWidth={2.5} />
        ) : (
          <span className="questionnaire-check h-1.5 w-1.5 rounded-full bg-background" />
        ))}
    </span>
  )
}

function isLongDescription(text: string): boolean {
  if (text.length > LONG_DESC_CHAR_LIMIT) return true
  const lineCount = text.split('\n').length
  return lineCount > LONG_DESC_LINE_LIMIT
}

export function QuestionnaireOptions({
  question,
  draft,
  focusedIndex,
  compact = false,
  wideCustom = false,
  onChoose,
  onChooseCustom,
  onCustomChange,
  onPreview,
  onCommit,
}: QuestionnaireOptionsProps) {
  const { t } = useTranslation()
  const multi = !!question.multiSelect
  const customRef = useRef<HTMLTextAreaElement>(null)
  const [expandedDescs, setExpandedDescs] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpandedDescs({})
  }, [question.question])

  useEffect(() => {
    if (draft.useCustom) customRef.current?.focus({ preventScroll: true })
  }, [draft.useCustom])

  useLayoutEffect(() => {
    const el = customRef.current
    if (!el || !draft.useCustom) return
    el.style.height = 'auto'
    const minH = wideCustom ? 96 : compact ? 54 : 64
    const maxH = wideCustom ? 260 : compact ? 150 : 200
    el.style.height = `${Math.max(minH, Math.min(el.scrollHeight, maxH))}px`
  }, [compact, draft.custom, draft.useCustom, wideCustom])

  const freeTextOnly = question.options.length === 0

  if (freeTextOnly) {
    return (
      <div className="space-y-1.5">
        {question.description && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">{question.description}</p>
        )}
        <textarea
          ref={customRef}
          className="w-full resize-none overflow-y-auto rounded-[9px] border border-border/80 bg-[var(--bg-1)]/50 px-3 py-2 text-[12.5px] leading-5 text-foreground outline-none transition-colors focus:border-foreground/35 focus:bg-[var(--bg-base)]"
          rows={compact ? 2 : 3}
          placeholder={t('extension:qOtherPlaceholder')}
          value={draft.custom}
          onChange={(event) => onCustomChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              onCommit()
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className={cn(compact ? 'space-y-1' : 'space-y-1.5')} role={multi ? 'group' : 'radiogroup'} aria-label={question.question}>
      {question.options.map((option, index) => {
        const checked = !draft.useCustom && draft.selected.includes(option.label)
        const { displayLabel, isRecommended } = parseOptionRecommendation(option.label, question.recommended)
        const recReason = isRecommended ? question.recommendedBecause?.trim() : undefined
        const desc = option.description?.trim() ?? ''
        const descRich = Boolean(desc && (hasRichMarkdownSyntax(desc) || desc.includes('\n')))
        const descLong = Boolean(desc && isLongDescription(desc))
        const descExpanded = !!expandedDescs[option.label]

        return (
          <div
            key={option.label}
            className={cn(
              'questionnaire-option rounded-[9px] border transition-colors',
              checked
                ? 'border-foreground/30 bg-[var(--bg-2)]/75'
                : focusedIndex === index
                  ? 'border-border bg-[var(--bg-hover)]/75'
                  : 'border-border/60 bg-transparent hover:border-border hover:bg-[var(--bg-hover)]/50',
            )}
            onMouseEnter={() => onPreview(option.label)}
          >
            <button
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={checked}
              className={cn(
                'flex w-full items-start text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
                compact ? 'gap-2.5 rounded-[9px] px-2.5 py-2' : 'gap-3 rounded-[9px] px-3 py-2.5',
              )}
              onClick={() => onChoose(option.label)}
              onFocus={() => onPreview(option.label)}
            >
              <Indicator checked={checked} multi={multi} compact={compact} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'flex flex-wrap items-center gap-1.5 break-words [overflow-wrap:anywhere] font-medium text-foreground',
                    compact ? 'text-[12.5px] leading-[18px]' : 'text-[13px] leading-5',
                  )}
                >
                  <span>{displayLabel}</span>
                  {isRecommended && (
                    <span className="inline-flex shrink-0 items-center rounded border border-[var(--success-semantic,#16a34a)]/30 bg-[var(--success-semantic,#16a34a)]/[0.09] px-1.5 py-px text-[10px] font-medium leading-[14px] text-[var(--success-semantic,#16a34a)]">
                      {t('extension:qRecommended')}
                    </span>
                  )}
                </span>
                {recReason && (
                  <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-foreground-secondary">
                    {recReason}
                  </span>
                )}
                {desc && (
                  <span
                    className={cn(
                      'mt-0.5 block leading-[1.45] text-muted-foreground',
                      compact ? 'text-[11.5px]' : 'text-[12px]',
                      descLong && !descExpanded && 'relative max-h-[5.5rem] overflow-hidden',
                    )}
                  >
                    {descRich ? (
                      <QuestionnaireMarkdown content={desc} compact plainHeadings />
                    ) : (
                      <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{desc}</span>
                    )}
                    {descLong && !descExpanded && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[var(--bg-base)] to-transparent"
                      />
                    )}
                  </span>
                )}
              </span>
              {index < 9 && (
                <kbd className="mt-0.5 hidden shrink-0 rounded border border-border/55 bg-[var(--bg-1)] px-1 font-mono text-[10px] leading-4 text-muted-foreground/65 sm:block">
                  {index + 1}
                </kbd>
              )}
            </button>

            {descLong && (
              <div className={cn(compact ? 'px-8 pb-1.5 pt-0' : 'px-10 pb-2 pt-0')}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedDescs((prev) => ({ ...prev, [option.label]: !prev[option.label] }))
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  <ChevronDown className={cn('h-3 w-3 transition-transform', descExpanded && 'rotate-180')} />
                  <span>{descExpanded ? t('extension:qCollapseText') : t('extension:qExpandText')}</span>
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Custom free-form option row — slim single-line trigger in compact inline mode */}
      <div
        className={cn(
          'questionnaire-option flex w-full flex-col rounded-[9px] border transition-colors',
          draft.useCustom
            ? 'border-foreground/30 bg-[var(--bg-2)]/65'
            : focusedIndex === question.options.length
              ? 'border-border bg-[var(--bg-hover)]/75'
              : 'border-dashed border-border/65 bg-transparent hover:border-border hover:bg-[var(--bg-hover)]/45',
        )}
      >
        <button
          type="button"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={draft.useCustom}
          className={cn(
            'flex w-full items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
            compact ? 'gap-2.5 rounded-[9px] px-2.5 py-1.5' : 'items-start gap-3 rounded-[9px] px-3 py-2.5',
          )}
          onClick={onChooseCustom}
        >
          <Indicator checked={draft.useCustom} multi={false} compact={compact} />
          {compact ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
              <span className="text-[12px] font-medium text-foreground-secondary">{t('extension:qOther')}</span>
              {!draft.useCustom && (
                <span className="truncate text-[11.5px] text-muted-foreground/75">
                  · {multi ? t('extension:qOtherHintMulti') : t('extension:qOtherHint')}
                </span>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-5">{t('extension:qOther')}</span>
              {!draft.useCustom && (
                <span className="mt-0.5 block text-[12px] leading-[1.45] text-muted-foreground">
                  {multi ? t('extension:qOtherHintMulti') : t('extension:qOtherHint')}
                </span>
              )}
            </span>
          )}
        </button>
        {draft.useCustom && (
          <div className={cn('questionnaire-reveal w-full', compact ? 'px-2.5 pb-2.5 pt-0.5' : 'px-3 pb-3')}>
            <textarea
              ref={customRef}
              className="w-full resize-none overflow-y-auto rounded-md border border-border/80 bg-[var(--bg-base)] px-2.5 py-1.5 text-[12.5px] leading-5 text-foreground outline-none focus:border-foreground/35"
              rows={wideCustom ? 4 : 2}
              placeholder={t('extension:qOtherPlaceholder')}
              value={draft.custom}
              onChange={(event) => onCustomChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  onCommit()
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
