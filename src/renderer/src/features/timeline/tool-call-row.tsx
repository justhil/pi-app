import { useState } from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveToolCardTemplate } from './tool-card-registry'
import { renderNativeToolPreview } from './tool-previews'
import { buildToolSummary } from './tool-previews'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'

const NATIVE_TOOLS = new Set(['read', 'edit', 'write', 'grep', 'ffgrep', 'fffind', 'find', 'bash', 'ls'])

function ToolOutputExpanded({ item }: { item: any }) {
  const name = item.toolName || ''
  if (NATIVE_TOOLS.has(name)) {
    const native = renderNativeToolPreview(item)
    if (native) return <>{native}</>
  }
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
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const isCurrentRun = !!item.runId && item.runId === activeRunId
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const hasToolBody = !!item.toolOutput || !!item.toolDetails || !!item.toolArgs
  const autoExpanded = agentRunning && isCurrentRun && hasToolBody
  const expanded = userExpanded ?? autoExpanded
  const rawSum = toolSummaryLine(item)

  return (
    <div className={cn(compact ? 'py-0' : 'py-0.5')}>
      <button
        type="button"
        onClick={() => hasToolBody && setUserExpanded(!(userExpanded ?? autoExpanded))}
        className={cn(
          'group row-hover flex w-full items-center gap-1.5 rounded-md text-left',
          compact ? 'px-1.5 py-1' : 'rounded-lg px-2 py-1.5',
          hasToolBody && 'cursor-pointer',
          !hasToolBody && 'cursor-default',
        )}
      >
        {hasToolBody && (
          <ChevronRight
            className="chevron-expand h-3 w-3 shrink-0 text-aou-4"
            data-open={expanded ? 'true' : 'false'}
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
      <CollapsiblePanel open={expanded && hasToolBody} className="mt-0.5">
        <div className="ml-3 border-l border-border/40 pl-2 pb-1">
          <ToolOutputExpanded item={item} />
        </div>
      </CollapsiblePanel>
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