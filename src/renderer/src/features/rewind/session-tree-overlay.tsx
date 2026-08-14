import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, RefreshCw, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import {
  SessionTreeList,
  TREE_FILTER_OPTS,
  filterSessionTreeNodes,
  resolveViewTargetId,
  type SessionTreeNode,
  type TreeFilterMode,
} from '@renderer/features/rewind/session-tree-list'

export function SessionTreeOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const rawTree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)
  const [filter, setFilter] = useState<TreeFilterMode>('default')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const filtered = useMemo(() => filterSessionTreeNodes(rawTree, filter), [rawTree, filter])
  const { nodes: visible, truncated, hiddenCount } = useMemo(
    () => capSessionTreeForDisplay(filtered),
    [filtered],
  )
  const showGuides = filter !== 'user-only' && visible.length <= 400

  useEffect(() => {
    if (!open) return
    if (selectedId && visible.some((n) => n.id === selectedId)) return
    const prefer =
      [...visible].reverse().find((n) => !n.isLeaf) ?? visible.find((n) => n.isLeaf) ?? visible[0]
    setSelectedId(prefer?.id ?? null)
  }, [open, visible, selectedId])

  const view = useCallback(
    async (id: string) => {
      const node = rawTree.find((n) => n.id === id)
      if (!node) return
      if (node.isLeaf) {
        toast.info('已是当前对话位置')
        return
      }
      onClose()
      // 延迟一帧再跳转，确保浮层卸载不中断异步链
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      requestTimelineViewEntry(id)
    },
    [rawTree, onClose],
  )

  const rewind = useCallback(
    async (id: string) => {
      const node = rawTree.find((n) => n.id === id)
      if (!node) return
      if (node.isLeaf) {
        toast.info('已是当前对话位置')
        return
      }
      onClose()
      // 延迟一帧再跳转，确保浮层卸载不中断异步链
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await navigateSessionToEntry(id)
    },
    [rawTree, onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (!visible.length) return
      const idx = visible.findIndex((n) => n.id === selectedId)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = visible[Math.min(visible.length - 1, idx < 0 ? 0 : idx + 1)]
        if (next) setSelectedId(next.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = visible[Math.max(0, idx < 0 ? 0 : idx - 1)]
        if (next) setSelectedId(next.id)
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        // 与单击共用同一映射：toolResult / 元条目解析到最近的可见消息，避免发原始 id 落点失败
        const idx = visible.findIndex((n) => n.id === selectedId)
        void view(resolveViewTargetId(visible, idx >= 0 ? idx : 0))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, visible, selectedId, view, onClose])

  if (!open) return null

  return (
    <div
      data-tree-overlay
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      aria-label="会话树"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[min(82vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">会话树</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('timeline:treeOverlayHint')}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title="刷新" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border/40 px-4 py-2">
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
              {o.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!sessionFile ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">未选择会话</p>
          ) : loading && rawTree.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              加载…
            </div>
          ) : treeError ? (
            <p className="px-3 py-8 text-center text-[12px] text-destructive">加载失败：{treeError}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">无匹配节点</p>
          ) : (
            <>
              {truncated && (
                <p className="mb-2 px-2 text-center text-[11px] text-muted-foreground">
                  仅显示最近 {visible.length} 个节点（另有 {hiddenCount} 个已省略，可在右栏会话树查看）
                </p>
              )}
              <SessionTreeList
                nodes={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onActivate={(id) => void rewind(id)}
                onView={(id) => void view(id)}
                viewOnSingleClick
                showGuides={showGuides}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}