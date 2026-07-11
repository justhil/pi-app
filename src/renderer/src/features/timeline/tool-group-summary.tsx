import { memo, useState } from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, ListTree } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow, summarizeToolGroup } from './tool-call-row'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'

function ToolGroupSummaryImpl({
  tools,
  autoExpandedToolIds,
}: {
  tools: ToolTimelineItem[]
  autoExpandedToolIds: Set<string>
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const { label, running, hasError } = summarizeToolGroup(tools)
  const groupRunId = tools[0]?.runId as string | undefined
  const isCurrentRun = !!groupRunId && groupRunId === activeRunId
  const anyInBudget = tools.some((t) => autoExpandedToolIds.has(t.id))
  const autoExpanded = agentRunning && isCurrentRun && anyInBudget
  const expanded = userExpanded ?? autoExpanded

  return (
    <div className="timeline-message-row py-0.5">
      <button
        type="button"
        onClick={() => setUserExpanded(!(userExpanded ?? autoExpanded))}
        className={cn(
          'group tool-group-hit flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-200',
          running && 'tool-group-hit--live',
          hasError && !running && 'tool-group-hit--error',
        )}
      >
        <ChevronRight
          className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/50"
          data-open={expanded ? 'true' : 'false'}
        />
        <ListTree className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/70" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-secondary group-hover:text-foreground">
          {label}
        </span>
        {running ? (
          <span className="tool-status-live flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
            <span className="tool-status-live-dot" />
          </span>
        ) : hasError ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" aria-label="error" />
        ) : null}
      </button>
      <CollapsiblePanel open={expanded} className="mt-1">
        <div
          className="space-y-0.5 rounded-lg border border-border/25 px-1 py-1"
          style={{ background: 'color-mix(in srgb, var(--bg-1) 90%, transparent)' }}
        >
          {tools.map((toolItem) => (
            <div key={toolItem.id}>
              <ToolCallRow
                item={toolItem}
                compact
                autoExpandedInBudget={autoExpandedToolIds.has(toolItem.id)}
              />
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </div>
  )
}

export const ToolGroupSummary = memo(ToolGroupSummaryImpl)
