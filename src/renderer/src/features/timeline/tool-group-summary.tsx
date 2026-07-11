import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow } from './tool-call-row'
import { ThinkingChainBlock } from './thinking-chain-block'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineClusterChild } from './timeline-display-items'
import {
  buildToolListActivitySummary,
  formatCollapsedToolActivityLine,
} from './timeline-turn-activity'

function DiffStatInline({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums opacity-80">
      {additions > 0 && <span className="text-emerald-600/90 dark:text-emerald-400/85">+{additions}</span>}
      {deletions > 0 && <span className="text-rose-500/80 dark:text-rose-400/80">-{deletions}</span>}
    </span>
  )
}

/**
 * Multi-tool cluster: collapsed activity line by default.
 * Auto-expands when any tool is in the auto-expand budget (max>0).
 * Children render in timeline order (thinking / tool / mid-turn prose).
 */
function ToolGroupSummaryImpl({
  tools,
  clusterChildren,
  autoExpandedToolIds,
  thinkingText,
  foldedAssistantTexts,
}: {
  tools: ToolTimelineItem[]
  clusterChildren?: TimelineClusterChild[]
  autoExpandedToolIds?: Set<string>
  /** @deprecated fallback when clusterChildren missing */
  thinkingText?: string
  /** @deprecated fallback when clusterChildren missing */
  foldedAssistantTexts?: string[]
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
  const anyInBudget =
    !!autoExpandedToolIds && tools.some((tool) => autoExpandedToolIds.has(tool.id))
  const autoExpanded = agentRunning && isCurrentRun && anyInBudget
  const expanded = userExpanded ?? autoExpanded

  const summary = useMemo(
    () => buildToolListActivitySummary(tools, fileChanges, workspace),
    [tools, fileChanges, workspace],
  )

  const activityLabel = useMemo(() => {
    const line = formatCollapsedToolActivityLine(summary, t)
    if (line) return line
    const names = [...new Set(tools.map((tool) => tool.toolName || 'tool'))]
    return t('timeline:activity.usedTools', {
      count: tools.length,
      names: names.slice(0, 4).join(', '),
    })
  }, [summary, t, tools])

  const orderedChildren = useMemo((): TimelineClusterChild[] => {
    if (clusterChildren && clusterChildren.length > 0) return clusterChildren
    const legacy: TimelineClusterChild[] = []
    const think = thinkingText?.trim()
    if (think) {
      legacy.push({ kind: 'thinking', id: 'legacy-think', text: think, streaming: running })
    }
    for (const tool of tools) {
      legacy.push({
        kind: 'tool',
        item: {
          id: tool.id,
          type: 'tool-call',
          toolName: tool.toolName,
          toolPhase: tool.toolPhase,
          toolArgs: tool.toolArgs,
          toolDetail: tool.toolDetail,
          toolOutput: tool.toolOutput,
          toolCallId: tool.toolCallId,
          runId: tool.runId,
          isError: tool.isError,
          toolStatusLine: tool.toolStatusLine,
          extensionUiSuspended: tool.extensionUiSuspended,
        },
      })
    }
    for (const [proseIndex, prose] of (foldedAssistantTexts || []).entries()) {
      const trimmed = prose.trim()
      if (trimmed) legacy.push({ kind: 'prose', id: `legacy-prose-${proseIndex}`, text: trimmed })
    }
    return legacy
  }, [clusterChildren, thinkingText, foldedAssistantTexts, tools, running])

  return (
    <div className="timeline-message-row py-0.5">
      <button
        type="button"
        onClick={() => setUserExpanded(!(userExpanded ?? autoExpanded))}
        className={cn(
          'group tool-group-hit flex w-full items-center gap-1 rounded-sm px-0.5 py-0.5 text-left transition-colors duration-150',
          running && 'tool-group-hit--live',
          hasError && !running && 'tool-group-hit--error',
        )}
      >
        <ChevronRight
          className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/40"
          data-open={expanded ? 'true' : 'false'}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[11px] leading-snug',
            running
              ? 'text-foreground-secondary/65 animate-tool-live-pulse'
              : 'text-foreground-secondary/70 group-hover:text-foreground/85',
          )}
        >
          {activityLabel}
          {!running && <DiffStatInline additions={summary.additions} deletions={summary.deletions} />}
        </span>
      </button>
      <CollapsiblePanel open={expanded} className="mt-0">
        <div className="ml-3 space-y-0.5 border-l border-border/15 pl-1.5">
          {orderedChildren.map((child) => {
            if (child.kind === 'thinking') {
              return (
                <ThinkingChainBlock
                  key={child.id}
                  text={child.text}
                  streaming={!!child.streaming}
                  startedAt={child.startedAt}
                  labelSeed={child.id}
                  nested
                />
              )
            }
            if (child.kind === 'prose') {
              return (
                <div
                  key={child.id}
                  className="py-0.5 text-[12px] leading-[1.55] text-foreground-secondary/65 whitespace-pre-wrap break-words"
                >
                  {child.text}
                </div>
              )
            }
            const toolItem = child.item as unknown as ToolTimelineItem
            return (
              <div key={toolItem.id}>
                <ToolCallRow
                  item={toolItem}
                  compact
                  autoExpandedInBudget={!!autoExpandedToolIds?.has(toolItem.id)}
                />
              </div>
            )
          })}
        </div>
      </CollapsiblePanel>
    </div>
  )
}

export const ToolGroupSummary = memo(ToolGroupSummaryImpl)
