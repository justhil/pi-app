import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow } from './tool-call-row'
import { ThinkingChainBlock } from './thinking-chain-block'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineClusterChild } from './timeline-display-items'
import {
  buildToolListActivitySummary,
  formatCollapsedToolActivityLine,
} from './timeline-turn-activity'
import { DiffStatBadge } from './diff-stat-badge'

/**
 * Sealed activity summary (after following prose has closed the segment).
 * Default: one summary line; click expands tool details.
 * Expand uses conditional render (not grid 0fr) so nested tool rows always mount correctly.
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
  thinkingText?: string
  foldedAssistantTexts?: string[]
}) {
  const { t } = useTranslation()
  const [userExpanded, setUserExpanded] = useState(false)
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)

  const hasError = tools.some((tool) => tool.isError)

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
      legacy.push({ kind: 'thinking', id: 'legacy-think', text: think })
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
  }, [clusterChildren, thinkingText, foldedAssistantTexts, tools])

  return (
    <div className="py-0">
      <button
        type="button"
        aria-expanded={userExpanded}
        onClick={() => setUserExpanded((prev) => !prev)}
        className={cn(
          'group timeline-activity-row tool-group-hit w-full',
          hasError && 'tool-group-hit--error',
        )}
      >
        <ChevronRight
          className="chevron-expand h-3 w-3 shrink-0 timeline-text-placeholder"
          data-open={userExpanded ? 'true' : 'false'}
        />
        <span className="timeline-activity-label timeline-text-quiet min-w-0 truncate group-hover:opacity-70">
          {activityLabel}
        </span>
        <DiffStatBadge
          additions={summary.additions}
          deletions={summary.deletions}
          className="ml-auto pl-2"
        />
      </button>
      {userExpanded ? (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/12 pl-1.5">
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
                  className="timeline-mid-prose py-0.5 whitespace-pre-wrap break-words"
                >
                  {child.text}
                </div>
              )
            }
            const toolItem = child.item as unknown as ToolTimelineItem
            return (
              <div key={toolItem.id || toolItem.toolCallId}>
                <ToolCallRow
                  item={toolItem}
                  compact
                  autoExpandedInBudget={!!autoExpandedToolIds?.has(toolItem.id)}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export const ToolGroupSummary = memo(ToolGroupSummaryImpl)
