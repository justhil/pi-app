import {
  ArrowLeft,
  Bot,
  ChevronRight,
  GitBranch,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Wrench,
} from '@renderer/components/icons'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { SessionTreeBranchGutter } from './session-tree-branch-gutter'
import {
  buildSessionTreeLayout,
  treeColX,
  treeGutterWidth,
  type SessionTreeLayout,
  type SessionTreeLayoutRow,
} from './session-tree-layout'
import {
  filterDenoisedTreeNodes,
  formatTreeNodeTime,
  type TurnCardMeta,
} from './session-tree-turns'

export type SessionTreeNode = {
  id: string
  parentId?: string | null
  depth: number
  label?: string
  entryType: string
  isLeaf: boolean
  role?: string
  preview?: string
  timestamp?: string
}

export function sessionTreeLineTitle(n: SessionTreeNode, t: (key: string) => string): string {
  if (n.label) return n.label
  if (n.entryType === 'message') {
    const p = (n.preview || '').replace(/\s+/g, ' ').trim()
    if (p) return p.length > 120 ? `${p.slice(0, 120)}…` : p
    if (n.role === 'user') return t('timeline:treeRoleUser')
    if (n.role === 'assistant') return t('timeline:treeRoleAssistant')
    return t('timeline:treeRoleMessage')
  }
  if (n.entryType === 'compaction') return t('timeline:treeEntryCompaction')
  if (n.entryType === 'branch_summary') return t('timeline:treeEntryBranchSummary')
  if (n.entryType === 'thinking_level_change') return t('timeline:treeEntryThinkingLevel')
  if (n.entryType === 'model_change') return t('timeline:treeEntryModel')
  return n.entryType
}

export type TreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all'

/** Filter tabs; `labelKey` is an i18n key. */
export const TREE_FILTER_OPTS: { key: TreeFilterMode; labelKey: string }[] = [
  { key: 'default', labelKey: 'timeline:treeFilterDefault' },
  { key: 'user-only', labelKey: 'timeline:treeFilterUser' },
  { key: 'all', labelKey: 'timeline:treeFilterAll' },
]

export function filterSessionTreeNodes(nodes: SessionTreeNode[], mode: TreeFilterMode): SessionTreeNode[] {
  return filterDenoisedTreeNodes(nodes, mode)
}

/** 时间线里能直接落点的树条目：user/assistant/system 消息。 */
function isLandableViewTarget(n: SessionTreeNode): boolean {
  if (n.entryType !== 'message') return false
  // toolResult 的 entryType 也是 message，但时间线把它的输出合并进前一条
  // assistant 工具行，不生成该 entry id 的锚点——单击/Enter 跳过去无法落点
  return n.role !== 'toolResult'
}

/**
 * Non-message tree entries (tool / compaction / branch_summary / labels / toolResult)
 * have no 1:1 timeline row, so a view jump lands on the nearest message instead:
 * prefer the next one (the reply that used this entry), fall back to the previous one.
 */
export function resolveViewTargetId(nodes: SessionTreeNode[], index: number): string {
  const node = nodes[index]
  if (!node) return ''
  if (isLandableViewTarget(node)) return node.id
  const preferNext = node.role !== 'toolResult'
  if (preferNext) {
    for (let i = index + 1; i < nodes.length; i++) {
      if (isLandableViewTarget(nodes[i])) return nodes[i].id
    }
  }
  for (let i = index - 1; i >= 0; i--) {
    if (isLandableViewTarget(nodes[i])) return nodes[i].id
  }
  if (!preferNext) {
    for (let i = index + 1; i < nodes.length; i++) {
      if (isLandableViewTarget(nodes[i])) return nodes[i].id
    }
  }
  return node.id
}

function nodeIcon(n: SessionTreeNode) {
  if (n.entryType === 'message' && n.role === 'user') return MessageSquare
  if (n.entryType === 'message' && n.role === 'assistant') return Bot
  if (n.entryType === 'compaction' || n.entryType === 'branch_summary') return Sparkles
  if (n.entryType.includes('tool') || n.entryType === 'tool') return Wrench
  return GitBranch
}

function nodeIconClass(n: SessionTreeNode): string {
  if (n.entryType === 'message' && n.role === 'user') return 'text-sky-600/75 dark:text-sky-400/75'
  if (n.entryType === 'message' && n.role === 'assistant') return 'text-[var(--brand)] opacity-80'
  if (n.entryType === 'compaction' || n.entryType === 'branch_summary') {
    return 'text-violet-600/75 dark:text-violet-400/75'
  }
  if (n.entryType.includes('tool') || n.entryType === 'tool') {
    return 'text-amber-700/70 dark:text-amber-400/70'
  }
  return 'text-muted-foreground/70'
}

export function SessionTreeList({
  nodes,
  allNodes,
  selectedId,
  onSelect,
  onActivate,
  className,
  rowClassName,
  showGuides = true,
  renderTrailing,
  viewOnSingleClick = false,
  onView,
  foldedIds,
  onToggleFold,
  layoutOverride,
  turnMetaById,
  matchedIds,
  cardMode = false,
}: {
  nodes: SessionTreeNode[]
  /** Unfiltered full tree used to project real parent chains and active path across filters. */
  allNodes?: SessionTreeNode[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  /** Non-destructive view jump: single click scrolls the timeline to the node's message. */
  onView?: (id: string) => void
  className?: string
  rowClassName?: string
  /** false：仅文本列表 */
  showGuides?: boolean
  /** Optional trailing control per row (e.g. Fork on user messages) */
  renderTrailing?: (node: SessionTreeNode) => ReactNode
  /** true: single click on a non-leaf row views it (no rewind); double-click rewinds. */
  viewOnSingleClick?: boolean
  /** Controlled set of folded node IDs. When omitted, folding state is managed internally. */
  foldedIds?: ReadonlySet<string>
  onToggleFold?: (id: string) => void
  /** Optional precomputed layout from parent panel/overlay to avoid double work. */
  layoutOverride?: SessionTreeLayout
  /** Plan A: turn metadata map pairing user nodes with their reply & tool-step counts. */
  turnMetaById?: ReadonlyMap<string, TurnCardMeta>
  /** When search is active, IDs directly matching the query (ancestors not in set are dimmed). */
  matchedIds?: ReadonlySet<string> | null
  /** Render compact rounded cards (used by TreePanel in Turn & User-only modes). */
  cardMode?: boolean
}) {
  const { t } = useTranslation()
  const [internalFoldedIds, setInternalFoldedIds] = useState<Set<string>>(() => new Set())
  const effectiveFoldedIds = foldedIds ?? internalFoldedIds

  const handleToggleFold = useCallback(
    (id: string) => {
      if (onToggleFold) {
        onToggleFold(id)
        return
      }
      setInternalFoldedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [onToggleFold],
  )

  const computedLayout = useMemo<SessionTreeLayout | null>(() => {
    if (!showGuides) return null
    if (layoutOverride) return layoutOverride
    return buildSessionTreeLayout(nodes, { allNodes, foldedIds: effectiveFoldedIds })
  }, [showGuides, layoutOverride, nodes, allNodes, effectiveFoldedIds])

  const rows = useMemo<SessionTreeLayoutRow[]>(() => {
    if (computedLayout) return computedLayout.rows
    return nodes.map((node, index) => ({
      node,
      sourceIndex: index,
      col: 0,
      branchDepth: node.depth,
      parentId: null,
      parentCol: null,
      isForkChild: false,
      isLastChild: true,
      forkChildCount: 0,
      branchColor: null,
      ancestorRails: [],
      onActivePath: true,
      isActiveTip: node.isLeaf,
      upperTrunkActive: false,
      upperTrunkColor: null,
      lowerTrunkActive: false,
      lowerTrunkColor: null,
      hasVisibleChildren: false,
      hasActiveChild: false,
      outgoingStemColor: null,
      foldable: false,
      isFolded: false,
      hiddenDescendantCount: 0,
      foldedContainsActive: false,
    }))
  }, [computedLayout, nodes])

  // Debounces single-click view jumps so the second click of a double-click
  // cancels the pending jump instead of firing a view before the rewind.
  const viewTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (viewTimer.current) window.clearTimeout(viewTimer.current)
    },
    [],
  )

  const scheduleView = useCallback(
    (targetId: string) => {
      if (!viewOnSingleClick || !onView) return
      if (viewTimer.current) window.clearTimeout(viewTimer.current)
      viewTimer.current = window.setTimeout(() => {
        viewTimer.current = null
        onView(targetId)
      }, 250)
    },
    [onView, viewOnSingleClick],
  )

  const fireRewind = useCallback(
    (targetId: string) => {
      if (!onActivate) return
      if (viewTimer.current) {
        window.clearTimeout(viewTimer.current)
        viewTimer.current = null
      }
      onActivate(targetId)
    },
    [onActivate],
  )

  const handleRowClick = useCallback(
    (n: SessionTreeNode, sourceIndex: number) => {
      onSelect?.(n.id)
      if (!viewOnSingleClick || n.isLeaf || !onView) return
      scheduleView(resolveViewTargetId(nodes, sourceIndex))
    },
    [nodes, onSelect, onView, scheduleView, viewOnSingleClick],
  )

  const handleRowDoubleClick = useCallback(
    (n: SessionTreeNode) => {
      if (n.isLeaf) return
      fireRewind(n.id)
    },
    [fireRewind],
  )

  return (
    <ul className={cn('w-full min-w-0', className)} role="tree">
      {rows.map((row) => {
        const n = row.node
        const turnMeta = turnMetaById?.get(n.id)
        const isTurnCard = Boolean(turnMeta)
        const isUser = n.entryType === 'message' && n.role === 'user'
        const isCardRow = isTurnCard || (cardMode && isUser)
        const selected = selectedId === n.id
        const trailing = renderTrailing?.(n)
        const gutterWidth = showGuides ? treeGutterWidth(row.col) : 0
        const title = sessionTreeLineTitle(n, t)
        const timeLabel = formatTreeNodeTime(turnMeta?.replyNode?.timestamp ?? n.timestamp)
        const isContextOnly = matchedIds ? !matchedIds.has(n.id) : false
        const isSearching = Boolean(matchedIds)
        const containsLeaf = Boolean(turnMeta?.containsLeaf || n.isLeaf)
        const isActiveCard = containsLeaf || (!isSearching && row.isActiveTip)
        const anchorY = isCardRow ? 18 : 15

        const rewindTargetId = turnMeta?.continueAfterId ?? n.id
        const canQuickRewind = Boolean(onActivate) && !containsLeaf && !n.isLeaf

        const foldButton = row.foldable ? (
          <button
            type="button"
            data-tree-fold-toggle={n.id}
            aria-label={t(row.isFolded ? 'timeline:treeExpandBranch' : 'timeline:treeCollapseBranch')}
            aria-expanded={!row.isFolded}
            title={t(row.isFolded ? 'timeline:treeExpandBranch' : 'timeline:treeCollapseBranch')}
            onClick={(event) => {
              event.stopPropagation()
              handleToggleFold(n.id)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            style={{
              left: treeColX(row.col) - 8,
              top: anchorY - 8,
              color:
                row.onActivePath || row.foldedContainsActive
                  ? 'var(--brand)'
                  : row.branchColor ?? undefined,
            }}
            className={cn(
              'absolute flex h-4 w-4 items-center justify-center rounded transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              !(row.onActivePath || row.foldedContainsActive || row.branchColor) &&
                'text-foreground-secondary hover:text-foreground',
            )}
          >
            <ChevronRight
              className={cn('h-3 w-3 transition-transform duration-150', !row.isFolded && 'rotate-90')}
              strokeWidth={2.25}
            />
          </button>
        ) : null

        const forkCountChip =
          row.forkChildCount >= 2 ? (
            <span
              data-tree-fork-badge={n.id}
              title={t('timeline:treeBranchCount', { count: row.forkChildCount })}
              className="inline-flex h-[17px] shrink-0 items-center gap-0.5 rounded bg-foreground/[0.055] px-1 text-[10px] font-medium tabular-nums text-foreground-secondary"
            >
              <GitBranch className="h-2.5 w-2.5 opacity-75" strokeWidth={2} />
              {row.forkChildCount}
            </span>
          ) : null

        const foldedBadge =
          row.isFolded && row.hiddenDescendantCount > 0 ? (
            <button
              type="button"
              data-tree-folded-badge={n.id}
              onClick={(event) => {
                event.stopPropagation()
                handleToggleFold(n.id)
              }}
              title={t('timeline:treeFoldedCount', { count: row.hiddenDescendantCount })}
              aria-label={t('timeline:treeFoldedCount', { count: row.hiddenDescendantCount })}
              style={
                row.foldedContainsActive
                  ? {
                      backgroundColor: 'color-mix(in srgb, var(--brand) 14%, transparent)',
                      color: 'var(--brand)',
                    }
                  : undefined
              }
              className={cn(
                'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10.5px] font-medium tabular-nums transition-colors',
                row.foldedContainsActive
                  ? 'hover:brightness-95'
                  : 'bg-foreground/[0.06] text-foreground-secondary hover:bg-foreground/[0.11] hover:text-foreground',
              )}
            >
              {row.foldedContainsActive && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--brand)' }} aria-hidden />
              )}
              +{row.hiddenDescendantCount}
            </button>
          ) : null

        const quickRewindButton = canQuickRewind ? (
          <button
            type="button"
            data-tree-rewind-btn={n.id}
            title={t('timeline:treeRewindHere')}
            aria-label={t('timeline:treeRewindHere')}
            onClick={(event) => {
              event.stopPropagation()
              fireRewind(rewindTargetId)
            }}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.9} />
          </button>
        ) : null

        if (isCardRow) {
          const replyNode = turnMeta?.replyNode
          const replyTitle = replyNode ? sessionTreeLineTitle(replyNode, t) : ''
          const showBranchStripe = row.isForkChild && !row.onActivePath && Boolean(row.branchColor)
          const showStandaloneCurrentTag = !replyNode && (n.isLeaf || (!isSearching && row.isActiveTip))
          const cardSurfaceStyle = isActiveCard
            ? {
                borderColor: selected
                  ? 'color-mix(in srgb, var(--brand) 58%, transparent)'
                  : 'color-mix(in srgb, var(--brand) 38%, transparent)',
                backgroundColor: selected
                  ? 'color-mix(in srgb, var(--brand) 9%, var(--bg-base))'
                  : 'color-mix(in srgb, var(--brand) 4.5%, var(--bg-base))',
              }
            : undefined

          return (
            <li
              key={n.id}
              className={cn('group/tree-row min-w-0', isContextOnly && 'opacity-55')}
              role="treeitem"
              aria-level={row.branchDepth + 1}
              aria-expanded={row.foldable ? !row.isFolded : undefined}
              data-tree-node-id={n.id}
              data-tree-col={row.col}
              data-active-path={row.onActivePath ? 'true' : undefined}
              data-active-tip={isActiveCard ? 'true' : undefined}
              data-turn-card={isTurnCard ? 'true' : undefined}
            >
              <div className="flex w-full min-w-0 items-stretch">
                {showGuides && (
                  <div
                    className="relative shrink-0 self-stretch"
                    style={{ width: gutterWidth }}
                    onClick={() => handleRowClick(n, row.sourceIndex)}
                    onDoubleClick={() => handleRowDoubleClick(n)}
                  >
                    <SessionTreeBranchGutter
                      row={row}
                      anchorY={anchorY}
                      containsLeaf={containsLeaf}
                      allowActiveTipMarker={!isSearching}
                    />
                    {foldButton}
                  </div>
                )}

                <div className="min-w-0 flex-1 py-[3px] pr-1">
                  <div
                    style={cardSurfaceStyle}
                    className={cn(
                      'relative overflow-hidden rounded-lg border px-2.5 py-1.5 transition-colors',
                      showBranchStripe && 'pl-3',
                      isActiveCard
                        ? 'hover:brightness-[0.99]'
                        : selected
                          ? 'border-border/80 bg-[var(--list-row-selected)]'
                          : row.onActivePath
                            ? 'border-border/60 bg-background/90 hover:border-border hover:bg-[var(--bg-hover)]'
                            : 'border-transparent bg-foreground/[0.03] hover:border-border/55 hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    {showBranchStripe && (
                      <span
                        aria-hidden
                        style={{ backgroundColor: row.branchColor!, opacity: 0.72 }}
                        className="pointer-events-none absolute bottom-1.5 left-0 top-1.5 w-[2.5px] rounded-r-full"
                      />
                    )}
                    {/* Card top row: user prompt + metadata/actions */}
                    <div className="flex items-start gap-1.5">
                      <button
                        type="button"
                        title={
                          n.isLeaf
                            ? t('timeline:treeCurrent')
                            : onActivate
                              ? t('timeline:treeViewNode')
                              : t('timeline:jumpToNode')
                        }
                        onClick={() => handleRowClick(n, row.sourceIndex)}
                        onDoubleClick={() => handleRowDoubleClick(n)}
                        onKeyDown={(event) => {
                          if (!row.foldable) return
                          if (event.key === 'ArrowLeft' && !row.isFolded) {
                            event.preventDefault()
                            handleToggleFold(n.id)
                          } else if (event.key === 'ArrowRight' && row.isFolded) {
                            event.preventDefault()
                            handleToggleFold(n.id)
                          }
                        }}
                        className={cn(
                          'min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50',
                          rowClassName,
                        )}
                      >
                        <span
                          className={cn(
                            'block line-clamp-2 break-words text-[12px] leading-[17px] text-foreground',
                            (row.onActivePath || isActiveCard) ? 'font-medium' : 'font-normal opacity-85 group-hover/tree-row:opacity-100',
                          )}
                          title={title}
                        >
                          {title}
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-1 pt-px">
                        {forkCountChip}
                        {foldedBadge}
                        {showStandaloneCurrentTag && (
                          <span className="panel-tag shrink-0 gap-0.5">
                            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
                            {t('timeline:treeCurrentTag')}
                          </span>
                        )}
                        {timeLabel && (
                          <span
                            className={cn(
                              'text-[10px] tabular-nums text-foreground-tertiary/80',
                              (canQuickRewind || trailing) && 'group-hover/tree-row:hidden group-focus-within/tree-row:hidden',
                            )}
                          >
                            {timeLabel}
                          </span>
                        )}
                        {(canQuickRewind || trailing) && (
                          <div className="hidden items-center gap-0.5 group-hover/tree-row:flex group-focus-within/tree-row:flex">
                            {quickRewindButton}
                            {trailing}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card bottom sub-row: paired assistant reply summary + tool step chip */}
                    {replyNode && (
                      <div className="mt-1 flex items-center gap-1.5 border-t border-border/35 pt-1">
                        <button
                          type="button"
                          title={
                            replyNode.isLeaf
                              ? t('timeline:treeCurrent')
                              : onActivate
                                ? t('timeline:treeViewNode')
                                : t('timeline:jumpToNode')
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            onSelect?.(n.id)
                            if (replyNode.isLeaf) return
                            scheduleView(replyNode.id)
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            if (replyNode.isLeaf) return
                            fireRewind(replyNode.id)
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                        >
                          <span
                            className="shrink-0 text-[10px] leading-none text-foreground-tertiary/70"
                            aria-hidden
                          >
                            ↳
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-[11px] leading-[15px] text-foreground-secondary/85"
                            title={replyTitle}
                          >
                            {replyTitle}
                          </span>
                          {replyNode.isLeaf && (
                            <span className="panel-tag shrink-0 gap-0.5">
                              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
                              {t('timeline:treeCurrentTag')}
                            </span>
                          )}
                        </button>
                        {turnMeta && turnMeta.toolSteps > 0 && (
                          <span
                            data-tree-tool-steps={n.id}
                            className="inline-flex h-[16px] shrink-0 items-center gap-0.5 rounded bg-foreground/[0.045] px-1 text-[10px] tabular-nums text-foreground-tertiary"
                            title={t('timeline:treeToolSteps', { count: turnMeta.toolSteps })}
                          >
                            <Wrench className="h-2.5 w-2.5 opacity-70" strokeWidth={1.8} />
                            {turnMeta.toolSteps}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        }

        // Compact single-line row (All mode, Compaction/Event pills, Overlay list, or showGuides=false)
        return (
          <li
            key={n.id}
            className={cn('group/tree-row min-w-0', isContextOnly && 'opacity-55')}
            role="treeitem"
            aria-level={row.branchDepth + 1}
            aria-expanded={row.foldable ? !row.isFolded : undefined}
            data-tree-node-id={n.id}
            data-tree-col={row.col}
            data-active-path={row.onActivePath ? 'true' : undefined}
            data-active-tip={isActiveCard ? 'true' : undefined}
          >
            <div className="flex min-h-[30px] w-full min-w-0 max-w-full items-stretch">
              {showGuides && (
                <div
                  className="relative shrink-0 self-stretch"
                  style={{ width: gutterWidth }}
                  onClick={() => handleRowClick(n, row.sourceIndex)}
                  onDoubleClick={() => handleRowDoubleClick(n)}
                >
                  <SessionTreeBranchGutter row={row} anchorY={anchorY} allowActiveTipMarker={!isSearching} />
                  {foldButton}
                </div>
              )}

              <div
                className={cn(
                  'my-[1px] flex min-w-0 flex-1 items-center gap-1 rounded-md pr-1 transition-colors',
                  selected ? 'bg-[var(--list-row-selected)]' : 'hover:bg-[var(--bg-hover)]',
                )}
              >
                <button
                  type="button"
                  title={
                    n.isLeaf
                      ? t('timeline:treeCurrent')
                      : onActivate
                        ? t('timeline:treeViewNode')
                        : t('timeline:jumpToNode')
                  }
                  onClick={() => handleRowClick(n, row.sourceIndex)}
                  onDoubleClick={() => handleRowDoubleClick(n)}
                  onKeyDown={(event) => {
                    if (!row.foldable) return
                    if (event.key === 'ArrowLeft' && !row.isFolded) {
                      event.preventDefault()
                      handleToggleFold(n.id)
                    } else if (event.key === 'ArrowRight' && row.isFolded) {
                      event.preventDefault()
                      handleToggleFold(n.id)
                    }
                  }}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/50',
                    showGuides ? 'pl-1.5' : 'pl-2',
                    (n.isLeaf || row.isActiveTip) && 'font-medium',
                    rowClassName,
                  )}
                >
                  <span
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-1.5 transition-opacity',
                      showGuides && !row.onActivePath && !n.isLeaf && 'opacity-[0.76] group-hover/tree-row:opacity-100',
                    )}
                  >
                    {n.entryType !== 'message' ? (() => {
                      const Icon = nodeIcon(n)
                      return <Icon className={cn('h-3.5 w-3.5 shrink-0 opacity-80', nodeIconClass(n))} />
                    })() : null}
                    <span
                      className={cn(
                        'min-w-0 truncate text-[12px] leading-[24px]',
                        isUser ? 'text-foreground' : 'text-foreground-secondary',
                      )}
                      title={title}
                    >
                      {title}
                    </span>
                    {n.isLeaf && (
                      <span className="panel-tag shrink-0 gap-0.5">
                        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
                        {t('timeline:treeCurrentTag')}
                      </span>
                    )}
                  </span>
                </button>

                {forkCountChip}
                {foldedBadge}
                {timeLabel && (
                  <span
                    className={cn(
                      'shrink-0 text-[10px] tabular-nums text-foreground-tertiary/75',
                      (canQuickRewind || trailing) && 'group-hover/tree-row:hidden group-focus-within/tree-row:hidden',
                    )}
                  >
                    {timeLabel}
                  </span>
                )}
                {(canQuickRewind || trailing) && (
                  <div className="hidden shrink-0 items-center gap-0.5 group-hover/tree-row:flex group-focus-within/tree-row:flex">
                    {quickRewindButton}
                    {trailing}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
