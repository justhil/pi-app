import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { formatModelChip, formatThinkingChip } from '@renderer/lib/format-run-display'

/** Bottom-right of the composer: model and thinking level, each opening its own menu upwards. */
function ComposerModelStripImpl({
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

  const chip = cn(
    'composer-chip flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] tabular-nums',
    'text-foreground-secondary/80 hover:bg-[var(--bg-hover)] hover:text-foreground transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45',
  )

  return (
    <div className="flex min-w-0 items-center justify-end gap-0.5">
      <button
        type="button"
        data-composer-model-chip=""
        onClick={onModelClick}
        aria-haspopup="dialog"
        aria-expanded={!!modelPickerOpen}
        title={modelLabel === t('composer:selectModel') ? t('composer:selectModelHint') : t('composer:modelLabel', { name: model ?? modelLabel })}
        className={cn(chip, 'min-w-[76px] max-w-[min(180px,34vw)]', modelPickerOpen && 'bg-[var(--bg-active)] text-foreground')}
      >
        <span className="truncate">{modelLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
      <button
        type="button"
        data-composer-thinking-chip=""
        onClick={onThinkingClick}
        aria-haspopup="dialog"
        aria-expanded={!!thinkingPickerOpen}
        title={t('composer:thinkingChip', { level: thinkLabel })}
        className={cn(chip, 'shrink-0', thinkingPickerOpen && 'bg-[var(--bg-active)] text-foreground')}
      >
        <span className="max-w-[88px] truncate">
          <span className="opacity-60">{t('composer:thinkingPrefix')}</span> {thinkLabel}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
    </div>
  )
}

export const ComposerModelStrip = memo(ComposerModelStripImpl)
