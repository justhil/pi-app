import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Loader2, RefreshCw, Search, Target, X } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import { buildSessionTreeLayout } from '@renderer/features/rewind/session-tree-layout'
import {
  buildTurnAggregatedNodes,
  filterTreeNodesByQuery,
} from '@renderer/features/rewind/session-tree-turns'
import {
  SessionTreeList,
  TREE_FILTER_OPTS,
  filterSessionTreeNodes,
  type SessionTreeNode,
  type TreeFilterMode,
} from '@renderer/features/rewind/session-tree-list'
import { cn } from '@renderer/lib/utils'

const EMPTY_SET: ReadonlySet<string> = new Set()

function FoldAllGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {collapsed ? (
        <>
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </>
      ) : (
        <>
          <path d="m7 20 5-5 5 5" />
          <path d="m7 4 5 5 5-5" />
        </>
      )}
    </svg>
  )
}

export function TreePanel() {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const rawTree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)
  const runStatus = useUIStore((s) => s.runState.status)
  const [filter, setFilter] = useState<TreeFilterMode>('default')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set())
  const prevRunStatusRef = useRef(runStatus)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingLocateRef = useRef(false)

  const refresh = useCallback(() => {
    if (!sessionFile) return
    void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    // 挂载 / 切换会话（含切到无会话）时刷新：树数据是发送时点刷新后的快照，
    // 仅凭空树判断会漏掉“新消息已写入 JSONL 但树未更新”的情况（例如压缩排队期间发送）。
    // sessionFile 变 null 也必须刷新：让请求序号递增，使 A 的在途旧请求失效，
    // 否则旧树的响应会在空会话 store 里回填。
    void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    setFoldedIds(new Set())
  }, [sessionFile, filter])

  useEffect(() => {
    setSearchQuery('')
  }, [sessionFile])

  useEffect(() => {
    const prev = prevRunStatusRef.current
    prevRunStatusRef.current = runStatus
    if (sessionFile && prev === 'running' && (runStatus === 'idle' || runStatus === 'failed')) {
      void refreshSessionTree(sessionFile)
    }
  }, [runStatus, sessionFile])

  const { baseNodes, turnMetaById } = useMemo(() => {
    if (filter === 'default') {
      const aggregated = buildTurnAggregatedNodes(rawTree)
      return { baseNodes: aggregated.nodes, turnMetaById: aggregated.turnMetaById }
    }
    return { baseNodes: filterSessionTreeNodes(rawTree, filter), turnMetaById: undefined }
  }, [rawTree, filter])

  const hasQuery = searchQuery.trim().length > 0

  const { nodes: searchedNodes, matchedIds } = useMemo(
    () => filterTreeNodesByQuery(baseNodes, rawTree, searchQuery, { turnMetaById }),
    [baseNodes, rawTree, searchQuery, turnMetaById],
  )

  const { nodes: display, truncated, hiddenCount } = useMemo(
    () => capSessionTreeForDisplay(searchedNodes),
    [searchedNodes],
  )

  const layout = useMemo(
    () => buildSessionTreeLayout(display, { allNodes: rawTree, foldedIds: hasQuery ? EMPTY_SET : foldedIds }),
    [display, rawTree, foldedIds, hasQuery],
  )

  const collapseTargets = useMemo(() => {
    const branchStarts = [...layout.foldableIds].filter((id) => {
      const pid = layout.visibleParentMap.get(id)
      return pid != null && (layout.visibleChildrenMap.get(pid)?.length ?? 0) > 1
    })
    return branchStarts.length > 0 ? branchStarts : [...layout.foldableIds]
  }, [layout])

  const inactiveBranchTargets = useMemo(
    () => collapseTargets.filter((id) => !layout.activePathIds.has(id)),
    [collapseTargets, layout.activePathIds],
  )

  const hasFoldable = !hasQuery && layout.foldableIds.size > 0
  const allFolded = collapseTargets.length > 0 && collapseTargets.every((id) => foldedIds.has(id))
  const canFocusActive = !hasQuery && layout.branchCount > 1 && inactiveBranchTargets.length > 0
  const isFocusingActive =
    canFocusActive &&
    inactiveBranchTargets.every((id) => foldedIds.has(id)) &&
    foldedIds.size === inactiveBranchTargets.length

  const toggleFold = useCallback((id: string) => {
    setFoldedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleFoldAll = useCallback(() => {
    if (allFolded) {
      setFoldedIds(new Set())
      return
    }
    setFoldedIds(new Set(collapseTargets))
  }, [allFolded, collapseTargets])

  const toggleFocusActive = useCallback(() => {
    if (isFocusingActive) {
      setFoldedIds(new Set())
      return
    }
    setFoldedIds(new Set(inactiveBranchTargets))
  }, [isFocusingActive, inactiveBranchTargets])

  const scrollToActiveTip = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const el = container.querySelector<HTMLElement>('[data-active-tip="true"]')
    if (!el) return
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    const tipId = el.dataset.treeNodeId
    if (tipId) setSelectedId(tipId)
  }, [])

  const locateCurrent = useCallback(() => {
    if (hasQuery) setSearchQuery('')
    setFoldedIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of prev) {
        if (layout.activePathIds.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
    pendingLocateRef.current = true
    requestAnimationFrame(() => {
      if (!pendingLocateRef.current) return
      pendingLocateRef.current = false
      scrollToActiveTip()
    })
  }, [hasQuery, layout.activePathIds, scrollToActiveTip])

  useEffect(() => {
    if (!pendingLocateRef.current) return
    pendingLocateRef.current = false
    scrollToActiveTip()
  }, [layout.rows, scrollToActiveTip])

  useEffect(() => {
    if (!selectedId) return
    if (!layout.rows.some((row) => row.node.id === selectedId)) {
      setSelectedId(null)
    }
  }, [layout.rows, selectedId])

  const summaryLabel = useMemo(() => {
    if (hasQuery && matchedIds) {
      return t('timeline:treeSearchMatches', { count: matchedIds.size })
    }
    const isTurns = filter === 'default'
    const turnCount = isTurns && turnMetaById ? display.filter((n) => turnMetaById.has(n.id)).length : 0
    const count = isTurns && turnCount > 0 ? turnCount : layout.totalVisibleCount
    if (count === 0) return ''
    if (layout.branchCount > 1) {
      return t(isTurns ? 'timeline:treeSummaryBranches' : 'timeline:treeSummaryBranchesItems', {
        branches: layout.branchCount,
        count,
      })
    }
    return t(isTurns ? 'timeline:treeSummaryTurns' : 'timeline:treeSummaryItems', { count })
  }, [hasQuery, matchedIds, filter, turnMetaById, display, layout.totalVisibleCount, layout.branchCount, t])

  if (!workspace) {
    return (
      <div className="p-4 text-[12px] leading-relaxed text-muted-foreground">{t('timeline:treeOpenWorkspace')}</div>
    )
  }

  return (
    <div className="tree-panel flex h-full flex-col text-[12px]">
      {/* Tier 1: Filter segmented control + hint + quick action buttons */}
      <div className="tree-panel-toolbar flex items-center gap-1 px-2.5 pb-1 pt-2">
        <div
          className="flex shrink-0 items-center rounded-md bg-[var(--bg-hover)] p-0.5"
          role="radiogroup"
          aria-label={t('timeline:treeFilterLabel')}
        >
          {TREE_FILTER_OPTS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={cn(
                'h-6 shrink-0 whitespace-nowrap rounded px-2 text-[11.5px] transition-colors',
                filter === option.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground',
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
        <span
          className="tree-panel-hint ml-auto min-w-0 truncate text-[11px] text-foreground-tertiary"
          title={t('timeline:treeClickHint')}
        >
          {t('timeline:treeClickHint')}
        </span>
        {display.length > 0 && (
          <button
            type="button"
            className="chrome-icon-btn shrink-0 rounded-md p-1.5"
            title={t('timeline:treeLocateCurrent')}
            aria-label={t('timeline:treeLocateCurrent')}
            onClick={locateCurrent}
          >
            <Target className="h-3.5 w-3.5" />
          </button>
        )}
        {hasFoldable && (
          <button
            type="button"
            className="chrome-icon-btn shrink-0 rounded-md p-1.5"
            title={t(allFolded ? 'timeline:treeExpandAll' : 'timeline:treeCollapseAll')}
            aria-label={t(allFolded ? 'timeline:treeExpandAll' : 'timeline:treeCollapseAll')}
            onClick={toggleFoldAll}
          >
            <FoldAllGlyph collapsed={allFolded} />
          </button>
        )}
        <button
          type="button"
          className="tree-panel-refresh chrome-icon-btn shrink-0 rounded-md p-1.5"
          title={t('common:refresh')}
          aria-label={t('common:refresh')}
          onClick={refresh}
          disabled={!sessionFile}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Tier 2: Compact search + branch/turn summary bar */}
      {sessionFile && rawTree.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 pb-1.5 pt-0.5">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3 w-3 text-foreground-tertiary/80" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && searchQuery) {
                  event.stopPropagation()
                  setSearchQuery('')
                }
              }}
              placeholder={t('timeline:treeSearchPlaceholder')}
              aria-label={t('timeline:treeSearchPlaceholder')}
              className="h-[26px] w-full min-w-0 rounded-md border border-border/55 bg-background/80 pl-6 pr-6 text-[11px] text-foreground placeholder:text-foreground-tertiary/75 transition-colors focus:border-border focus:outline-none"
            />
            {hasQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('timeline:treeSearchClear')}
                title={t('timeline:treeSearchClear')}
                className="absolute right-1 rounded p-0.5 text-foreground-tertiary hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {summaryLabel && (
            <span className="shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-foreground-tertiary">
              {summaryLabel}
            </span>
          )}
          {canFocusActive && (
            <button
              type="button"
              onClick={toggleFocusActive}
              title={t('timeline:treeFocusActiveBranch')}
              aria-pressed={isFocusingActive}
              style={
                isFocusingActive
                  ? {
                      backgroundColor: 'color-mix(in srgb, var(--brand) 14%, transparent)',
                      color: 'var(--brand)',
                    }
                  : undefined
              }
              className={cn(
                'h-[22px] shrink-0 whitespace-nowrap rounded px-1.5 text-[10.5px] font-medium transition-colors',
                isFocusingActive
                  ? 'hover:brightness-95'
                  : 'bg-foreground/[0.045] text-foreground-secondary hover:bg-foreground/[0.09] hover:text-foreground',
              )}
            >
              {t('timeline:treeFocusActiveShort')}
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1.5">
        {!sessionFile ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">{t('timeline:treeNoSession')}</p>
        ) : loading && rawTree.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('timeline:treeLoading')}
          </div>
        ) : treeError ? (
          <p className="px-3 py-6 text-[11px] text-amber-700/85 dark:text-amber-300/80">
            {t('timeline:treeLoadFailed', { error: treeError })}
          </p>
        ) : display.length === 0 ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">
            {rawTree.length === 0 ? t('timeline:treeEmpty') : t('timeline:treeNoMatch')}
          </p>
        ) : (
          <>
            {truncated && (
              <p className="px-3 pb-1.5 text-[10px] text-muted-foreground/80">
                {t('timeline:treePanelTruncated', { shown: display.length, hidden: hiddenCount })}
              </p>
            )}
            <SessionTreeList
              className="px-1.5"
              nodes={display}
              allNodes={rawTree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onActivate={(id) => void navigateSessionToEntry(id)}
              onView={(id) => requestTimelineViewEntry(id)}
              viewOnSingleClick
              showGuides={display.length > 0}
              foldedIds={hasQuery ? EMPTY_SET : foldedIds}
              onToggleFold={toggleFold}
              layoutOverride={layout}
              turnMetaById={turnMetaById}
              matchedIds={matchedIds}
              cardMode={filter !== 'all'}
              renderTrailing={(node) =>
                node.entryType === 'message' && node.role === 'user' ? (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                    title={t('timeline:treeForkNode')}
                    aria-label={t('timeline:treeForkNode')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void forkSessionFromEntry(node.id)
                    }}
                  >
                    <GitFork className="h-3 w-3" />
                  </button>
                ) : null
              }
            />
          </>
        )}
      </div>
    </div>
  )
}
