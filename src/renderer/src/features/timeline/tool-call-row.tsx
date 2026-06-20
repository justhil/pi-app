import { useState } from 'react'
import { ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveToolCardTemplate } from './tool-card-registry'
import { buildToolSummary } from './tool-previews'

function ToolOutputExpanded({ item }: { item: any }) {
  const template = resolveToolCardTemplate(item.toolName)
  return <>{renderToolCard(item, template)}</>
}

function toolSummaryLine(item: any): string {
  const argSummary = buildToolSummary(item.toolName || '', item.toolArgs)
  if (argSummary) return argSummary
  if (item.toolStatusLine) return String(item.toolStatusLine)
  const o = (item.toolOutput || '').trim()
  if (!o) return ''
  const l = o.split('\n').find((x: string) => x.trim()) || ''
  return l.length > 72 ? l.slice(0, 72) + '…' : l
}

export function ToolCallRow({
  item,
  compact,
}: {
  item: any
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const hasToolBody = !!item.toolOutput || !!item.toolDetails || !!item.toolArgs
  const rawSum = toolSummaryLine(item)

  return (
    <div className={cn(compact ? 'py-0' : 'py-0.5')}>
      <button
        type="button"
        onClick={() => hasToolBody && setExpanded(!expanded)}
        className={cn(
          'group row-hover flex w-full items-center gap-1.5 rounded-md text-left',
          compact ? 'px-1.5 py-1' : 'rounded-lg px-2 py-1.5',
          hasToolBody && 'cursor-pointer',
          !hasToolBody && 'cursor-default',
        )}
      >
        {hasToolBody && (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-aou-4 transition-transform duration-[var(--motion-fast)]',
              expanded && 'rotate-90',
            )}
          />
        )}
        <ToolIcon name={item.toolName} />
        <span className="text-[12px] font-mono text-aou-7">{item.toolName}</span>
        {rawSum && (
          <span className="ml-1 min-w-0 flex-1 truncate text-[11px] text-foreground-secondary">{rawSum}</span>
        )}
        {isRunning && <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-aou-5" />}
        {!isRunning && item.isError && <XCircle className="ml-auto h-3 w-3 shrink-0 text-destructive/70" />}
        {!isRunning && !item.isError && hasToolBody && (
          <CheckCircle2 className="ml-auto h-3 w-3 shrink-0 text-green-500/50" />
        )}
      </button>
      {expanded && hasToolBody && (
        <div className="mt-0.5 ml-3 border-l border-border/40 pl-2 animate-in fade-in slide-in-from-bottom-1 duration-[var(--motion-fast)]">
          <ToolOutputExpanded item={item} />
        </div>
      )}
    </div>
  )
}

export function summarizeToolGroup(tools: any[]): { label: string; running: boolean; hasError: boolean } {
  const names = tools.map((t) => t.toolName || 'tool')
  const uniq = [...new Set(names)]
  const head = uniq.slice(0, 4).join(', ')
  const more = uniq.length > 4 ? ` +${uniq.length - 4}` : ''
  const running = tools.some((t) => t.toolPhase === 'start' || t.toolPhase === 'update')
  const hasError = tools.some((t) => t.isError)
  return {
    label: `${tools.length} 次工具 · ${head}${more}`,
    running,
    hasError,
  }
}