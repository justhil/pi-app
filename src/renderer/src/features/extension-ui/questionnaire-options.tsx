import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { AskQuestionPayload } from './questionnaire-dialog'
import { hasRichMarkdownSyntax, QuestionnaireMarkdown } from './questionnaire-markdown'
import type { QuestionDraft } from './questionnaire-model'

const LONG_DESC_CHAR_LIMIT = 220
const LONG_DESC_LINE_LIMIT = 4

type QuestionnaireOptionsProps = {
  question: AskQuestionPayload
  draft: QuestionDraft
  /** When true (preview layout + custom selected), expand custom textarea generously. */
  wideCustom?: boolean
  onChoose: (label: string) => void
  onChooseCustom: () => void
  onCustomChange: (text: string) => void
  onPreview: (label: string) => void
  /** Ctrl/⌘+Enter inside the custom answer. */
  onCommit: () => void
}

function Indicator({ checked, multi }: { checked: boolean; multi: boolean }) {
  return (
    <span
      className={cn(
        'questionnaire-indicator mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center border',
        multi ? 'rounded-[4px]' : 'rounded-full',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
      )}
      aria-hidden
    >
      {checked &&
        (multi ? (
          <Check className="questionnaire-check h-3 w-3" />
        ) : (
          <span className="questionnaire-check h-1.5 w-1.5 rounded-full bg-primary-foreground" />
        ))}
    </span>
  )
}

function isLongDescription(text: string): boolean {
  if (text.length > LONG_DESC_CHAR_LIMIT) return true
  const lineCount = text.split('\n').length
  return lineCount > LONG_DESC_LINE_LIMIT
}

const rowClass = (checked: boolean) =>
  cn(
    'questionnaire-option flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none',
    'focus-visible:ring-2 focus-visible:ring-primary/40',
    checked ? 'border-primary/45 bg-primary/[0.06]' : 'border-border/70 hover:border-border hover:bg-accent/40',
  )

export function QuestionnaireOptions({
  question,
  draft,
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

  // Auto-grow custom answer textarea smoothly up to 220px without cramping long answers
  useLayoutEffect(() => {
    const el = customRef.current
    if (!el || !draft.useCustom) return
    el.style.height = 'auto'
    const minH = wideCustom ? 96 : 64
    const maxH = wideCustom ? 260 : 200
    el.style.height = `${Math.max(minH, Math.min(el.scrollHeight, maxH))}px`
  }, [draft.custom, draft.useCustom, wideCustom])

  return (
    <div className="space-y-1.5" role={multi ? 'group' : 'radiogroup'} aria-label={question.question}>
      {question.options.map((option, index) => {
        const checked = !draft.useCustom && draft.selected.includes(option.label)
        const desc = option.description?.trim() ?? ''
        const descRich = Boolean(desc && (hasRichMarkdownSyntax(desc) || desc.includes('\n')))
        const descLong = Boolean(desc && isLongDescription(desc))
        const descExpanded = !!expandedDescs[option.label]

        return (
          <div
            key={option.label}
            className={cn(
              'questionnaire-option rounded-lg border transition-colors',
              checked ? 'border-primary/45 bg-primary/[0.06]' : 'border-border/70 hover:border-border hover:bg-accent/40',
            )}
            onMouseEnter={() => onPreview(option.label)}
          >
            <button
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={checked}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => onChoose(option.label)}
              onFocus={() => onPreview(option.label)}
            >
              <Indicator checked={checked} multi={multi} />
              <span className="min-w-0 flex-1">
                <span className="block break-words [overflow-wrap:anywhere] text-[13px] font-medium leading-5">
                  {option.label}
                </span>
                {desc && (
                  <span
                    className={cn(
                      'mt-0.5 block text-[12px] leading-[1.45] text-muted-foreground',
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
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background/95 to-transparent"
                      />
                    )}
                  </span>
                )}
              </span>
              {index < 9 && (
                <kbd className="mt-0.5 hidden shrink-0 rounded border border-border/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground/60 sm:block">
                  {index + 1}
                </kbd>
              )}
            </button>

            {descLong && (
              <div className="px-10 pb-2 pt-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedDescs((prev) => ({ ...prev, [option.label]: !prev[option.label] }))
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary/85 hover:bg-muted/70 hover:text-primary"
                >
                  <ChevronDown className={cn('h-3 w-3 transition-transform', descExpanded && 'rotate-180')} />
                  <span>{descExpanded ? t('extension:qCollapseText') : t('extension:qExpandText')}</span>
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div className={cn(rowClass(draft.useCustom), 'flex-col gap-0 p-0')}>
        <button
          type="button"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={draft.useCustom}
          className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={onChooseCustom}
        >
          <Indicator checked={draft.useCustom} multi={false} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-5">{t('extension:qOther')}</span>
            {!draft.useCustom && (
              <span className="mt-0.5 block text-[12px] leading-[1.45] text-muted-foreground">
                {multi ? t('extension:qOtherHintMulti') : t('extension:qOtherHint')}
              </span>
            )}
          </span>
        </button>
        {draft.useCustom && (
          <div className="questionnaire-reveal w-full px-3 pb-3">
            <textarea
              ref={customRef}
              className="w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-2.5 py-2 text-[13px] leading-5 outline-none focus:border-primary/50"
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
