import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveAdapterToolCardTemplate, resolveToolCardTemplate } from './tool-card-registry'
import { tryRenderAdapterToolCard } from '@extension-compat/renderer/render-adapter-tool-card'
import { renderNativeToolPreview } from './tool-previews'
import { buildToolSummary } from './tool-previews'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'

const NATIVE_TOOLS = new Set(['read', 'edit', 'insert', 'write', 'grep', 'ffgrep', 'fffind', 'find', 'bash', 'ls'])

function ToolOutputExpanded({ item }: { item: ToolTimelineItem }) {
  const name = item.toolName || ''
  const adapterTpl = resolveAdapterToolCardTemplate(name)
  const adapterPreview = tryRenderAdapterToolCard(item, adapterTpl)
  if (adapterPreview) return <>{adapterPreview}</>
  if (NATIVE_TOOLS.has(name)) {
    const native = renderNativeToolPreview(item, { flat: true })
    if (native) return <>{native}</>
  }
  const template = resolveToolCardTemplate(item.toolName)
  return <>{renderToolCard(item, template)}</>
}

function toolSummaryLine(item: ToolTimelineItem): string {
  const argSummary = buildToolSummary(item.toolName || '', item.toolArgs, item.toolDetail)
  if (argSummary) return argSummary
  if (item.toolStatusLine) return String(item.toolStatusLine)
  const o = (item.toolOutput || '').trim()
  if (!o) return ''
  const l = o.split('\n').find((x: string) => x.trim()) || ''
  return l.length > 72 ? l.slice(0, 72) + '…' : l
}

/**
 * Cursor-like tool row: single text line by default.
 * Auto-expand only when budget allows (max=0 → never).
 * Expanded body is flat (no nested title row).
 */
function ToolCallRowImpl({
  item,
  compact,
  autoExpandedInBudget = false,
}: {
  item: ToolTimelineItem
  compact?: boolean
  /** True when this tool falls in the auto-expand budget for the live run. */
  autoExpandedInBudget?: boolean
}) {
  const { t } = useTranslation()
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const rememberedExpanded = useUIStore((s) => {
    const toolCallId = item.toolCallId
    if (!toolCallId) return undefined
    const sessionKey =
      normalizeSessionFileKey(s.historySessionFile || '') || s.historySessionFile || '__none__'
    return s.toolExpandBySession[sessionKey]?.[toolCallId]
  })
  const setToolCallExpanded = useUIStore((s) => s.setToolCallExpanded)
  const isCurrentRun = !!item.runId && item.runId === activeRunId
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const hasToolBody = !!item.toolOutput || !!item.toolDetails || !!item.toolArgs
  const autoExpanded = agentRunning && isCurrentRun && hasToolBody && autoExpandedInBudget
  // User preference wins; otherwise auto-expand budget for live tools.
  const expanded = rememberedExpanded ?? autoExpanded
  const rawSum = toolSummaryLine(item)
  const liveStatus =
    isRunning && item.toolStatusLine ? String(item.toolStatusLine) : null

  return (
    <div className={cn('tool-call-row', compact ? 'py-0' : 'py-px')}>
      <button
        type="button"
        onClick={() => {
          if (!hasToolBody) return
          const next = !expanded
          if (item.toolCallId) setToolCallExpanded(item.toolCallId, next)
        }}
        className={cn(
          'group tool-call-row-hit flex w-full items-center gap-1 rounded-sm text-left transition-colors duration-150',
          compact ? 'px-0.5 py-0.5' : 'px-1 py-0.5',
          hasToolBody && 'cursor-pointer',
          !hasToolBody && 'cursor-default',
          isRunning && 'tool-call-row-hit--live',
          item.isError && !isRunning && 'tool-call-row-hit--error',
        )}
      >
        {hasToolBody ? (
          <ChevronRight
            className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/40"
            data-open={expanded ? 'true' : 'false'}
          />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <ToolIcon name={item.toolName || ''} className="h-3 w-3 shrink-0 opacity-55" />
        <span
          className={cn(
            'max-w-[9rem] shrink-0 truncate text-[11px] font-mono tracking-tight',
            isRunning
              ? 'text-foreground-secondary/70 animate-tool-live-pulse'
              : 'text-foreground-secondary/55',
          )}
        >
          {item.toolName}
        </span>
        {item.extensionUiSuspended ? (
          <button
            type="button"
            className="ml-1 shrink-0 rounded-sm border border-border/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              useExtensionUIStore.getState().resumeSuspended()
            }}
          >
            {t('timeline:continueAnswering')}
          </button>
        ) : (
          <span
            className={cn(
              'ml-0.5 min-w-0 flex-1 truncate text-[11px] leading-snug',
              isRunning
                ? 'text-foreground-secondary/65 animate-tool-live-pulse'
                : 'text-foreground-secondary/70',
            )}
          >
            {liveStatus ? liveStatus : rawSum ? rawSum : isRunning ? '…' : null}
          </span>
        )}
      </button>
      <CollapsiblePanel open={expanded && hasToolBody} className="mt-0">
        <div className="tool-call-body ml-3.5 border-l border-border/15 pl-1.5 pb-0.5 pt-0.5">
          <ToolOutputExpanded item={item} />
        </div>
      </CollapsiblePanel>
    </div>
  )
}

export const ToolCallRow = memo(ToolCallRowImpl)
