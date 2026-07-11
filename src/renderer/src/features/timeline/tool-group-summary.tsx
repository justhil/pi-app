import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow } from './tool-call-row'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import {
  buildToolListActivitySummary,
  formatCollapsedToolActivityLine,
} from './timeline-turn-activity'

function DiffStatInline({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {deletions > 0 && <span className="text-rose-500/90 dark:text-rose-400/90">-{deletions}</span>}
    </span>
  )
}

/**
 * Collapsed multi-tool header — Cursor-style activity line:
 * "Edited a.ts, explored 3 files, ran 1 command +2 -17"
 * Expand reveals individual tool rows.
 */
function ToolGroupSummaryImpl({
  tools,
  autoExpandedToolIds,
}: {
  tools: ToolTimelineItem[]
  autoExpandedToolIds: Set<string>
}) {
  const { t } = useTranslation()
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)

  const running = tools.some((tool) => tool.toolPhase === 'start' || tool.toolPhase === 'update')
  const hasError = tools.some((tool) => tool.isError)
  const groupRunId = tools[0]?.runId as string | undefined
  const isCurrentRun = !!groupRunId && groupRunId === activeRunId
  const anyInBudget = tools.some((tool) => autoExpandedToolIds.has(tool.id))
  const autoExpanded = agentRunning && isCurrentRun && anyInBudget
  const expanded = userExpanded ?? autoExpanded

  const summary = useMemo(
    () => buildToolListActivitySummary(tools, fileChanges, workspace),
    [tools, fileChanges, workspace],
  )

  const activityLabel = useMemo(() => {
    const line = formatCollapsedToolActivityLine(summary, t)
    if (line) return line
    // Fallback while tools are still starting (no paths yet)
    const names = [...new Set(tools.map((tool) => tool.toolName || 'tool'))]
    return t('timeline:activity.usedTools', {
      count: tools.length,
      names: names.slice(0, 4).join(', '),
    })
  }, [summary, t, tools])

  return (
    <div className="timeline-message-row py-0.5">
      <button
        type="button"
        onClick={() => setUserExpanded(!(userExpanded ?? autoExpanded))}
        className={cn(
          'group tool-group-hit flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-200',
          running && 'tool-group-hit--live',
          hasError && !running && 'tool-group-hit--error',
        )}
      >
        <ChevronRight
          className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/45"
          data-open={expanded ? 'true' : 'false'}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-foreground-secondary/80 group-hover:text-foreground">
          {activityLabel}
          {!running && <DiffStatInline additions={summary.additions} deletions={summary.deletions} />}
        </span>
        {running ? (
          <span className="tool-status-live flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
            <span className="tool-status-live-dot" />
          </span>
        ) : hasError ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" aria-label="error" />
        ) : null}
      </button>
      <CollapsiblePanel open={expanded} className="mt-0.5">
        <div className="space-y-0.5 rounded-md border border-border/25 px-1 py-0.5">
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
