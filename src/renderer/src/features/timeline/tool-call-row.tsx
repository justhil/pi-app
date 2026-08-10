import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, BookOpen } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveAdapterToolCardTemplate, resolveToolCardTemplate } from './tool-card-registry'
import { tryRenderAdapterToolCard } from '@extension-compat/renderer/render-adapter-tool-card'
import { renderNativeToolPreview } from './tool-previews'
import { buildToolSummary } from './tool-previews'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { countToolDiffStats } from './timeline-turn-activity'
import { DiffStatBadge } from './diff-stat-badge'
import { resolveSkillContextActivity } from './skill-context-activity'

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

function toolArgSummary(item: ToolTimelineItem): string {
  const argSummary = buildToolSummary(item.toolName || '', item.toolArgs, item.toolDetail)
  if (argSummary) return argSummary
  if (item.toolStatusLine) return String(item.toolStatusLine)
  const output = (item.toolOutput || '').trim()
  if (!output) return ''
  const firstLine = output.split('\n').find((line) => line.trim()) || ''
  return firstLine.length > 72 ? firstLine.slice(0, 72) + '…' : firstLine
}

function humanToolVerbKey(toolName: string): string {
  const name = (toolName || '').toLowerCase()
  if (name === 'read' || name === 'ls') return 'timeline:activity.verbRead'
  if (name === 'edit' || name === 'write' || name === 'insert') return 'timeline:activity.verbEdit'
  if (name === 'bash') return 'timeline:activity.verbRun'
  if (name === 'grep' || name === 'ffgrep' || name === 'find' || name === 'fffind') {
    return 'timeline:activity.verbSearch'
  }
  return 'timeline:activity.verbUsed'
}

/**
 * Paper Agent tool row: natural-language summary as primary text.
 * Mutate tools show +N -M on the right; auto-expand respects budget.
 * Expand always works via local state; session store is optional persistence.
 */
function ToolCallRowImpl({
  item,
  compact,
  autoExpandedInBudget = false,
}: {
  item: ToolTimelineItem
  compact?: boolean
  autoExpandedInBudget?: boolean
}) {
  const { t } = useTranslation()
  const expandKey = item.toolCallId || item.id
  const rememberedExpanded = useUIStore((s) => {
    if (!expandKey) return undefined
    const sessionKey =
      normalizeSessionFileKey(s.historySessionFile || '') || s.historySessionFile || '__none__'
    return s.toolExpandBySession[sessionKey]?.[expandKey]
  })
  const setToolCallExpanded = useUIStore((s) => s.setToolCallExpanded)
  // Local fallback when store key missing or store write fails — click must always toggle.
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null)
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const hasToolBody = !!(item.toolOutput || item.toolDetails || item.toolArgs || item.toolDetail)
  // 滑动窗口：是否由静态尾部窗口选中（不依赖 agent 运行状态，历史会话同样生效）
  const autoExpanded = autoExpandedInBudget && hasToolBody
  const expanded =
    localExpanded ?? rememberedExpanded ?? autoExpanded
  const argSummary = toolArgSummary(item)
  const skillContext = resolveSkillContextActivity(item.toolName || '', item.toolArgs, item.toolDetail)
  const liveStatus = isRunning && item.toolStatusLine ? String(item.toolStatusLine) : null
  const diffStats = useMemo(() => countToolDiffStats(item), [item])

  const primaryLabel = useMemo(() => {
    if (skillContext) {
      return t('timeline:activity.skillContext', {
        name: skillContext.name,
      })
    }
    if (liveStatus) return liveStatus
    if (argSummary) {
      return t(humanToolVerbKey(item.toolName || ''), {
        detail: argSummary,
        name: item.toolName || 'tool',
        defaultValue: argSummary,
      })
    }
    if (isRunning) return t('timeline:activity.workingTool', { name: item.toolName || 'tool' })
    return item.toolName || t('timeline:activity.usedTools', { count: 1, names: 'tool' })
  }, [skillContext, liveStatus, argSummary, isRunning, item.toolName, t])

  const toggleExpanded = () => {
    if (!hasToolBody) return
    const next = !expanded
    setLocalExpanded(next)
    if (expandKey) setToolCallExpanded(expandKey, next)
  }

  return (
    <div className={cn('tool-call-row', compact ? 'py-0' : 'py-0')}>
      <button
        type="button"
        title={skillContext ? primaryLabel : item.toolName || undefined}
        aria-expanded={!!expanded && hasToolBody}
        onClick={toggleExpanded}
        className={cn(
          'group timeline-activity-row tool-call-row-hit px-0.5 py-0 w-full',
          hasToolBody && 'cursor-pointer',
          !hasToolBody && 'cursor-default',
          isRunning && 'tool-call-row-hit--live',
          item.isError && !isRunning && 'tool-call-row-hit--error',
        )}
      >
        {hasToolBody ? (
          <ChevronRight
            className="chevron-expand h-3 w-3 shrink-0 timeline-text-placeholder"
            data-open={expanded ? 'true' : 'false'}
          />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        {skillContext ? (
          <BookOpen className="h-3 w-3 shrink-0 text-primary/75" strokeWidth={1.8} />
        ) : (
          <ToolIcon name={item.toolName || ''} className="h-3 w-3 shrink-0 timeline-text-quiet" />
        )}
        {item.extensionUiSuspended ? (
          <button
            type="button"
            className="ml-1 shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] timeline-text-secondary hover:bg-[var(--bg-hover)]"
            onClick={(event) => {
              event.stopPropagation()
              useExtensionUIStore.getState().resumeSuspended()
            }}
          >
            {t('timeline:continueAnswering')}
          </button>
        ) : (
          <span
            className={cn(
              'timeline-activity-label min-w-0 truncate',
              skillContext ? 'timeline-text-secondary' : 'timeline-text-quiet',
              isRunning && 'timeline-activity-label--live',
              !isRunning && 'group-hover:opacity-70',
            )}
          >
            {primaryLabel}
          </span>
        )}
        <DiffStatBadge
          additions={diffStats.additions}
          deletions={diffStats.deletions}
          className="ml-auto pl-2"
        />
      </button>
      {expanded && hasToolBody ? (
        <div className="tool-call-body ml-3.5 border-l border-border/12 pl-1.5 pb-0.5 pt-0.5">
          <ToolOutputExpanded item={item} />
        </div>
      ) : null}
    </div>
  )
}

export const ToolCallRow = memo(ToolCallRowImpl)
