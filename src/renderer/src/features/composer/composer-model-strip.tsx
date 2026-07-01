import { cn } from '@renderer/lib/utils'
import { formatModelChip, formatThinkingChip } from '@renderer/lib/format-run-display'

/** 输入框区域右下角：模型 / thinking */
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
        title={modelLabel === '选择模型' ? '选择模型（点击）' : `模型：${model ?? modelLabel}`}
        className={cn(btn, modelPickerOpen && 'text-foreground-secondary/75')}
      >
        {modelLabel}
      </button>
      <span className="text-foreground-secondary/20 text-[10px]">/</span>
      <button
        type="button"
        onClick={onThinkingClick}
        title={`思考等级：${thinkLabel}`}
        className={cn(btn, 'max-w-[88px]', thinkingPickerOpen && 'text-foreground-secondary/75')}
      >
        {thinkLabel}
      </button>
    </div>
  )
}