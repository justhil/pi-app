import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { formatModelChip, formatThinkingChip, normalizeThinkingLevel } from '@renderer/lib/format-run-display'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Three-bar glyph: how much of the thinking range the level uses. */
function ThinkingBars({ level }: { level?: string }) {
  const index = Math.max(0, LEVELS.indexOf(normalizeThinkingLevel(level) ?? 'off'))
  const lit = index === 0 ? 0 : index <= 2 ? 1 : index <= 4 ? 2 : 3
  return (
    <span className="composer-thinking-bars" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span key={bar} data-on={bar < lit || undefined} style={{ height: 4 + bar * 3 }} />
      ))}
    </span>
  )
}

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
        className={cn(chip, 'max-w-[min(180px,34vw)]', modelPickerOpen && 'bg-[var(--bg-active)] text-foreground')}
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
        <ThinkingBars level={thinkingLevel} />
        <span className="max-w-[64px] truncate">{thinkLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
    </div>
  )
}

export const ComposerModelStrip = memo(ComposerModelStripImpl)
