import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveAdapterToolCardTemplate, resolveToolCardTemplate } from './tool-card-registry'
import { tryRenderAdapterToolCard } from '@extension-compat/renderer/render-adapter-tool-card'
import { renderNativeToolPreview } from './tool-previews'
import { buildToolSummary } from './tool-previews'
import i18n from '@renderer/lib/i18n'
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
    const native = renderNativeToolPreview(item)
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

/** Cursor-like: quiet status chip — pulse when live, soft check/warn when done */
function ToolStatusMark({
  isRunning,
  isError,
  hasBody,
}: {
  isRunning: boolean
  isError: boolean
  hasBody: boolean
}) {
  if (isRunning) {
    return (
      <span className="tool-status-live ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        <span className="tool-status-live-dot" />
      </span>
    )
  }
  if (isError) {
    return (
      <span
        className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70"
        title="error"
        aria-label="error"
      />
    )
  }
  if (hasBody) {
    return (
      <span
        className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        aria-hidden
      />
    )
  }
  return null
}

function ToolCallRowImpl({
  item,
  compact,
  autoExpandedInBudget = true,
}: {
  item: ToolTimelineItem
  compact?: boolean
  /** 当前 run 内是否落在自动展开预算（默认 true 供组内 compact 子行） */
  autoExpandedInBudget?: boolean
}) {
  const { t } = useTranslation()
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const isCurrentRun = !!item.runId && item.runId === activeRunId
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const hasToolBody = !!item.toolOutput || !!item.toolDetails || !!item.toolArgs
  const autoExpanded = agentRunning && isCurrentRun && hasToolBody && autoExpandedInBudget
  const expanded = userExpanded ?? autoExpanded
  const rawSum = toolSummaryLine(item)
  const liveStatus =
    isRunning && item.toolStatusLine ? String(item.toolStatusLine) : null

  return (
    <div className={cn('tool-call-row', compact ? 'py-0' : 'py-0.5')}>
      <button
        type="button"
        onClick={() => hasToolBody && setUserExpanded(!(userExpanded ?? autoExpanded))}
        className={cn(
          'group tool-call-row-hit flex w-full items-center gap-1.5 rounded-md text-left transition-colors duration-200',
          compact ? 'px-1.5 py-1' : 'rounded-lg px-2 py-1.5',
          hasToolBody && 'cursor-pointer',
          !hasToolBody && 'cursor-default',
          isRunning && 'tool-call-row-hit--live',
          item.isError && !isRunning && 'tool-call-row-hit--error',
        )}
      >
        {hasToolBody ? (
          <ChevronRight
            className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/45"
            data-open={expanded ? 'true' : 'false'}
          />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <ToolIcon name={item.toolName || ''} className="h-3.5 w-3.5 shrink-0" />
        <span
          className={cn(
            'shrink-0 text-[12px] font-mono tracking-tight',
            isRunning ? 'text-foreground/90' : 'text-foreground-secondary',
          )}
        >
          {item.toolName}
        </span>
        {item.extensionUiSuspended ? (
          <button
            type="button"
            className="ml-1 shrink-0 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber-800/90 dark:text-amber-200/85 hover:bg-amber-500/15"
            onClick={(e) => {
              e.stopPropagation()
              useExtensionUIStore.getState().resumeSuspended()
            }}
          >
            {t('timeline:continueAnswering')}
          </button>
        ) : (
          <span className="ml-1 min-w-0 flex-1 truncate text-[11px] leading-snug text-foreground-secondary/75">
            {liveStatus ? (
              <span className="animate-thinking-pulse text-sky-700/80 dark:text-sky-300/80">
                {liveStatus}
              </span>
            ) : rawSum ? (
              rawSum
            ) : isRunning ? (
              <span className="animate-thinking-pulse text-foreground-secondary/55">…</span>
            ) : null}
          </span>
        )}
        {!item.extensionUiSuspended && (
          <ToolStatusMark isRunning={isRunning} isError={!!item.isError} hasBody={hasToolBody} />
        )}
      </button>
      <CollapsiblePanel open={expanded && hasToolBody} className="mt-0.5">
        <div className="tool-call-body ml-3 border-l border-border/35 pl-2.5 pb-1">
          <ToolOutputExpanded item={item} />
        </div>
      </CollapsiblePanel>
    </div>
  )
}

export const ToolCallRow = memo(ToolCallRowImpl)

export function summarizeToolGroup(tools: ToolTimelineItem[]): {
  label: string
  running: boolean
  hasError: boolean
} {
  const names = tools.map((t) => t.toolName || 'tool')
  const uniq = [...new Set(names)]
  const head = uniq.slice(0, 4).join(', ')
  const more = uniq.length > 4 ? ` +${uniq.length - 4}` : ''
  const running = tools.some((t) => t.toolPhase === 'start' || t.toolPhase === 'update')
  const hasError = tools.some((t) => t.isError)
  return {
    label: i18n.t('timeline:toolsCount', { count: tools.length, head, more }),
    running,
    hasError,
  }
}
