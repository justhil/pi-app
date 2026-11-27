import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Search, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import { buildSessionTreeLayout } from '@renderer/features/rewind/session-tree-layout'
import { filterTreeNodesByQuery } from '@renderer/features/rewind/session-tree-turns'
import {
  SessionTreeList,
  TREE_FILTER_OPTS,
  filterSessionTreeNodes,
  resolveViewTargetId,
  type SessionTreeNode,
  type TreeFilterMode,
} from '@renderer/features/rewind/session-tree-list'

const EMPTY_SET: ReadonlySet<string> = new Set()

export function SessionTreeOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const rawTree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)
  const [filter, setFilter] = useState<TreeFilterMode>('default')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    if (sessionFile) void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    if (!open) return
    const tid = window.setTimeout(() => {
      if (sessionFile) void refreshSessionTree(sessionFile)
    }, 0)
    return () => clearTimeout(tid)
  }, [open, sessionFile])

  useEffect(() => {
    setFoldedIds(new Set())
  }, [open, sessionFile, filter])

  useEffect(() => {
    if (!open) setSearchQuery('')
  }, [open])

  const filtered = useMemo(() => filterSessionTreeNodes(rawTree, filter), [rawTree, filter])
  const hasQuery = searchQuery.trim().length > 0
  const { nodes: searched, matchedIds } = useMemo(
    () => filterTreeNodesByQuery(filtered, rawTree, searchQuery),
    [filtered, rawTree, searchQuery],
  )
  const { nodes: visible, truncated, hiddenCount } = useMemo(
    () => capSessionTreeForDisplay(searched),
    [searched],
  )
  const layout = useMemo(
    () => buildSessionTreeLayout(visible, { allNodes: rawTree, foldedIds: hasQuery ? EMPTY_SET : foldedIds }),
    [visible, rawTree, foldedIds, hasQuery],
  )

  const toggleFold = useCallback((id: string) => {
    setFoldedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const rows = layout.rows
    if (selectedId && rows.some((r) => r.node.id === selectedId)) return
    const prefer =
      [...rows].reverse().find((r) => !r.node.isLeaf) ?? rows.find((r) => r.node.isLeaf) ?? rows[0]
    setSelectedId(prefer?.node.id ?? null)
  }, [open, layout.rows, selectedId])

  const view = useCallback(
    async (id: string) => {
      const node = rawTree.find((n) => n.id === id)
      if (!node) return
      if (node.isLeaf) {
        toast.info(t('timeline:treeAlreadyCurrent'))
        return
      }
      onClose()
      // 延迟一帧再跳转，确保浮层卸载不中断异步链
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      requestTimelineViewEntry(id)
    },
    [rawTree, onClose, t],
  )

  const rewind = useCallback(
    async (id: string) => {
      const node = rawTree.find((n) => n.id === id)
      if (!node) return
      if (node.isLeaf) {
        toast.info(t('timeline:treeAlreadyCurrent'))
        return
      }
      onClose()
      // 延迟一帧再跳转，确保浮层卸载不中断异步链
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await navigateSessionToEntry(id)
    },
    [rawTree, onClose, t],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const inSearchInput = document.activeElement === searchInputRef.current
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (inSearchInput && searchQuery) {
          setSearchQuery('')
          return
        }
        onClose()
        return
      }
      const rows = layout.rows
      if (!rows.length) return
      const idx = rows.findIndex((r) => r.node.id === selectedId)
      const currentRow = idx >= 0 ? rows[idx] : rows[0]
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = rows[Math.min(rows.length - 1, idx < 0 ? 0 : idx + 1)]
        if (next) setSelectedId(next.node.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = rows[Math.max(0, idx < 0 ? 0 : idx - 1)]
        if (next) setSelectedId(next.node.id)
      } else if (!inSearchInput && e.key === 'ArrowLeft' && currentRow) {
        e.preventDefault()
        if (currentRow.foldable && !currentRow.isFolded) {
          toggleFold(currentRow.node.id)
        } else if (currentRow.parentId) {
          setSelectedId(currentRow.parentId)
        }
      } else if (!inSearchInput && e.key === 'ArrowRight' && currentRow) {
        e.preventDefault()
        if (currentRow.foldable && currentRow.isFolded) {
          toggleFold(currentRow.node.id)
        } else {
          const firstChild = layout.visibleChildrenMap.get(currentRow.node.id)?.[0]
          if (firstChild) setSelectedId(firstChild)
        }
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        // 与单击共用同一映射：toolResult / 元条目解析到最近的可见消息，避免发原始 id 落点失败
        const sourceIdx = currentRow ? currentRow.sourceIndex : 0
        void view(resolveViewTargetId(visible, sourceIdx))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, visible, layout, selectedId, view, onClose, toggleFold, searchQuery])

  if (!open) return null

  return (
    <div
      data-tree-overlay
      className="overlay-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      aria-label={t('timeline:treeTitle')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="overlay-panel flex max-h-[min(82vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">{t('timeline:treeTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('timeline:treeOverlayHint')}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title={t('common:refresh')} onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title={t('common:close')} onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2">
          <div className="flex shrink-0 items-center gap-1">
            {TREE_FILTER_OPTS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setFilter(o.key)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                  filter === o.key ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(o.labelKey)}
              </button>
            ))}
          </div>
          <div className="relative ml-auto flex min-w-[160px] max-w-[260px] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3 w-3 text-foreground-tertiary/80" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('timeline:treeSearchPlaceholder')}
              aria-label={t('timeline:treeSearchPlaceholder')}
              className="h-[26px] w-full rounded-md border border-border/55 bg-background/80 pl-6 pr-6 text-[11px] text-foreground placeholder:text-foreground-tertiary/75 focus:border-border focus:outline-none"
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
        </div>

        <div ref={listRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!sessionFile ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('timeline:treeNoSession')}</p>
          ) : loading && rawTree.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('timeline:treeLoading')}
            </div>
          ) : treeError ? (
            <p className="px-3 py-8 text-center text-[12px] text-destructive">{t('timeline:treeLoadFailed', { error: treeError })}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('timeline:treeNoMatch')}</p>
          ) : (
            <>
              {truncated && (
                <p className="mb-2 px-2 text-center text-[11px] text-muted-foreground">
                  {t('timeline:treeTruncated', { shown: visible.length, hidden: hiddenCount })}
                </p>
              )}
              <SessionTreeList
                nodes={visible}
                allNodes={rawTree}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onActivate={(id) => void rewind(id)}
                onView={(id) => void view(id)}
                viewOnSingleClick
                showGuides={visible.length > 0}
                foldedIds={hasQuery ? EMPTY_SET : foldedIds}
                onToggleFold={toggleFold}
                layoutOverride={layout}
                matchedIds={matchedIds}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
