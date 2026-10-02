import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { AskQuestionPayload } from './questionnaire-dialog'
import type { QuestionDraft } from './questionnaire-model'

type QuestionnaireOptionsProps = {
  question: AskQuestionPayload
  draft: QuestionDraft
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

const rowClass = (checked: boolean) =>
  cn(
    'questionnaire-option flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none',
    'focus-visible:ring-2 focus-visible:ring-primary/40',
    checked ? 'border-primary/45 bg-primary/[0.06]' : 'border-border/70 hover:border-border hover:bg-accent/40',
  )

export function QuestionnaireOptions({
  question,
  draft,
  onChoose,
  onChooseCustom,
  onCustomChange,
  onPreview,
  onCommit,
}: QuestionnaireOptionsProps) {
  const { t } = useTranslation()
  const multi = !!question.multiSelect
  const customRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (draft.useCustom) customRef.current?.focus({ preventScroll: true })
  }, [draft.useCustom])

  return (
    <div className="space-y-1.5" role={multi ? 'group' : 'radiogroup'} aria-label={question.question}>
      {question.options.map((option, index) => {
        const checked = !draft.useCustom && draft.selected.includes(option.label)
        return (
          <button
            key={option.label}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={checked}
            className={rowClass(checked)}
            onClick={() => onChoose(option.label)}
            onMouseEnter={() => onPreview(option.label)}
            onFocus={() => onPreview(option.label)}
          >
            <Indicator checked={checked} multi={multi} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-5">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-[12px] leading-[1.45] text-muted-foreground">{option.description}</span>
              )}
            </span>
            {index < 9 && (
              <kbd className="mt-0.5 hidden rounded border border-border/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground/60 sm:block">
                {index + 1}
              </kbd>
            )}
          </button>
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
          <div className="questionnaire-reveal px-3 pb-3">
            <textarea
              ref={customRef}
              className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] leading-5 outline-none focus:border-primary/50"
              rows={2}
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
