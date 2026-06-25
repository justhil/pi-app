import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { formatModelChip, formatThinkingChip } from '@renderer/lib/format-run-display'

/** Bottom-right of input: model / thinking */
export function ComposerModelStrip({
  model,
  thinkingLevel,
  modelPickerOpen,
  thinkingPickerOpen,
  onModelClick,
  onThinkingClick,
}: {
  model?: string
  thinkingLevel?: string
  modelPickerOpen?: boolean
  thinkingPickerOpen?: boolean
  onModelClick: () => void
  onThinkingClick: () => void
}) {
  const { t } = useTranslation()
  const modelLabel = formatModelChip(model)
  const thinkLabel = formatThinkingChip(thinkingLevel)

  const btn = cn(
    'max-w-[min(160px,38vw)] truncate rounded px-1 py-0.5 text-[10px] tabular-nums',
    'text-foreground-secondary/45 hover:text-foreground-secondary/80 transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/25',
  )

  return (
    <div className="flex items-center justify-end gap-0.5">
      <button
        type="button"
        onClick={onModelClick}
        title={modelLabel === t('composer:selectModel') ? t('composer:selectModelHint') : t('composer:modelLabel', { name: model ?? modelLabel })}
        className={cn(btn, modelPickerOpen && 'text-foreground-secondary/75')}
      >
        {modelLabel}
      </button>
      <span className="text-foreground-secondary/20 text-[10px]">/</span>
      <button
        type="button"
        onClick={onThinkingClick}
        title={t('composer:thinkingLevel', { level: thinkLabel })}
        className={cn(btn, 'max-w-[88px]', thinkingPickerOpen && 'text-foreground-secondary/75')}
      >
        {thinkLabel}
      </button>
    </div>
  )
}