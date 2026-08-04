import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { GitBranch, X } from '@renderer/components/icons'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { resolveToolCardTemplate, useToolCardCatalogReady } from '@renderer/features/timeline/tool-card-registry'
import { normalizeTreeToolItem, TreeToolCard } from '@renderer/features/timeline/tree-tool-card'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

type ActivityPopoverLayout = {
  left: number
  width: number
  bottom: number
  maxHeight: number
}

function toolCallIdentity(item: TimelineItem): string {
  return item.toolCallId || item.id
}

function isLiveTreeTool(item: TimelineItem): boolean {
  return item.type === 'tool-call'
    && (item.toolPhase === 'start' || item.toolPhase === 'update')
    && resolveToolCardTemplate(item.toolName) === 'tree'
}

function idsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function ComposerAgentActivityPopover({
  open,
  rows,
  composerAnchorRef,
  triggerRef,
  onClose,
}: {
  open: boolean
  rows: TimelineItem[]
  composerAnchorRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  onClose: (restoreTriggerFocus: boolean) => void
}) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<ActivityPopoverLayout | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setLayout(null)
      setContentHeight(null)
      return
    }
    const syncLayout = () => {
      const composerAnchor = composerAnchorRef.current
      const trigger = triggerRef.current
      if (!composerAnchor || !trigger) return
      const composerRect = composerAnchor.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const viewportInset = 12
      const gap = 8
      const availableWidth = Math.max(0, window.innerWidth - viewportInset * 2)
      const composerWidth = composerRect.width > 0 ? composerRect.width : availableWidth
      const width = Math.min(560, composerWidth, availableWidth)
      const left = Math.min(
        Math.max(viewportInset, composerRect.left),
        Math.max(viewportInset, window.innerWidth - viewportInset - width),
      )
      const anchorTop = triggerRect.height > 0 ? triggerRect.top : composerRect.top
      const minimumPanelHeight = Math.min(
        120,
        Math.max(1, window.innerHeight - viewportInset * 2),
      )
      const desiredBottom = window.innerHeight - anchorTop + gap
      const maximumBottom = Math.max(
        viewportInset,
        window.innerHeight - viewportInset - minimumPanelHeight,
      )
      const bottom = Math.min(
        Math.max(viewportInset, desiredBottom),
        maximumBottom,
      )
      setLayout({
        left,
        width,
        bottom,
        maxHeight: Math.max(
          1,
          Math.min(520, window.innerHeight - viewportInset - bottom),
        ),
      })
    }

    syncLayout()
    const observer = new ResizeObserver(syncLayout)
    if (composerAnchorRef.current) observer.observe(composerAnchorRef.current)
    if (triggerRef.current) observer.observe(triggerRef.current)
    window.addEventListener('resize', syncLayout)
    window.addEventListener('scroll', syncLayout, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncLayout)
      window.removeEventListener('scroll', syncLayout, true)
    }
  }, [composerAnchorRef, open, triggerRef])

  useLayoutEffect(() => {
    if (!open || !layout) return
    const content = contentRef.current
    if (!content) return
    const syncContentHeight = () => setContentHeight(content.scrollHeight)
    syncContentHeight()
    const observer = new ResizeObserver(syncContentHeight)
    observer.observe(content)
    return () => observer.disconnect()
  }, [layout, open, rows])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose(true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open, triggerRef])

  if (!open || !layout || rows.length === 0) return null

  const views = rows.map(normalizeTreeToolItem)
  const runningCount = views.reduce((total, view, index) => {
    if (view.hasReliableRunningCount && view.runningCount > 0) return total + view.runningCount
    const row = rows[index]
    return total + (row.toolPhase === 'start' || row.toolPhase === 'update' ? 1 : 0)
  }, 0)
  const failedCount = views.reduce((total, view) => total + view.failedCount, 0)

  return createPortal(
    <div
      ref={panelRef}
      id="composer-agent-activity-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="composer-agent-activity-title"
      className="popover-motion electron-no-drag flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl"
      style={{
        position: 'fixed',
        left: layout.left,
        width: layout.width,
        bottom: layout.bottom,
        height: Math.min(layout.maxHeight, Math.max(120, contentHeight ?? layout.maxHeight)),
        maxHeight: layout.maxHeight,
        zIndex: 10000,
      }}
    >
      <OverlayScrollHost
        className="min-h-0 w-full flex-1"
        showRailOnHostHover
        scrollClassName="absolute inset-0 overscroll-contain"
      >
        <div ref={contentRef}>
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-popover/95 px-3.5 py-2.5 backdrop-blur-sm">
            <div className="min-w-0 flex-1">
              <h2 id="composer-agent-activity-title" className="text-[12px] font-semibold tracking-[-0.01em]">
                {t('composer:subagents.title')}
              </h2>
              <p className="text-[10px] text-foreground-secondary">
                {t('composer:subagents.summary', {
                  running: runningCount,
                  failed: failedCount,
                  runs: rows.length,
                })}
              </p>
            </div>
            <button
              type="button"
              aria-label={t('composer:subagents.close')}
              onClick={() => onClose(true)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="space-y-2 p-2.5">
            {rows.map((row) => (
              <TreeToolCard key={toolCallIdentity(row)} item={row} />
            ))}
          </div>
        </div>
      </OverlayScrollHost>
    </div>,
    document.body,
  )
}

export function ComposerAgentActivity({
  composerAnchorRef,
  completionPopoverOpen,
}: {
  composerAnchorRef: RefObject<HTMLDivElement | null>
  completionPopoverOpen: boolean
}) {
  const { t } = useTranslation()
  const timelineItems = useUIStore((state) => state.timelineItems)
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const currentSessionId = useUIStore((state) => state.currentSessionId)
  const historySessionFile = useUIStore((state) => state.historySessionFile)
  const catalogReady = useToolCardCatalogReady()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [retainedToolCallIds, setRetainedToolCallIds] = useState<string[]>([])

  const treeRows = useMemo(
    () => timelineItems.filter(
      (item) => item.type === 'tool-call' && resolveToolCardTemplate(item.toolName) === 'tree',
    ),
    [catalogReady, timelineItems],
  )
  const activeRows = useMemo(() => treeRows.filter(isLiveTreeTool), [treeRows])
  const rowsById = useMemo(
    () => new Map(treeRows.map((row) => [toolCallIdentity(row), row])),
    [treeRows],
  )
  const visibleRows = useMemo(
    () => retainedToolCallIds.map((id) => rowsById.get(id)).filter((row): row is TimelineItem => !!row),
    [retainedToolCallIds, rowsById],
  )

  const close = useCallback((restoreTriggerFocus: boolean) => {
    setOpen(false)
    setRetainedToolCallIds([])
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    close(false)
  }, [close, currentSessionId, currentWorkspace, historySessionFile])

  useEffect(() => {
    if (!completionPopoverOpen || !open) return
    close(false)
  }, [close, completionPopoverOpen, open])

  useEffect(() => {
    if (!open) return
    const existingIds = new Set(rowsById.keys())
    const activeIds = activeRows.map(toolCallIdentity)
    setRetainedToolCallIds((currentIds) => {
      const nextIds = currentIds.filter((id) => existingIds.has(id))
      for (const activeId of activeIds) {
        if (!nextIds.includes(activeId)) nextIds.push(activeId)
      }
      return idsEqual(currentIds, nextIds) ? currentIds : nextIds
    })
  }, [activeRows, open, rowsById])

  useEffect(() => {
    if (!open || retainedToolCallIds.length > 0) return
    close(false)
  }, [close, open, retainedToolCallIds.length])

  const activeViews = useMemo(() => activeRows.map(normalizeTreeToolItem), [activeRows])
  const hasReliableChildCount =
    activeViews.length > 0 && activeViews.every((view) => view.hasReliableRunningCount)
  const reliableRunningChildren = activeViews.reduce((total, view) => total + view.runningCount, 0)
  const countUsesChildren = hasReliableChildCount && reliableRunningChildren > 0
  const displayCount = countUsesChildren ? reliableRunningChildren : activeRows.length
  const launcherVisible = activeRows.length > 0 || (open && visibleRows.length > 0)
  const retainedRunCompleted = activeRows.length === 0 && open && visibleRows.length > 0

  if (!launcherVisible) return null

  const toggle = () => {
    if (open) {
      close(false)
      return
    }
    const activeIds = activeRows.map(toolCallIdentity)
    if (activeIds.length === 0) return
    setRetainedToolCallIds(activeIds)
    setOpen(true)
  }

  return (
    <div className="mb-1.5 flex min-h-7 items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="composer-agent-activity-popover"
        aria-label={retainedRunCompleted
          ? t('composer:subagents.completedAria')
          : t(
              countUsesChildren ? 'composer:subagents.childCountAria' : 'composer:subagents.runCountAria',
              { count: displayCount },
            )}
        onClick={toggle}
        className="electron-no-drag inline-flex h-7 items-center gap-1.5 rounded-full border border-border/55 bg-background/90 px-2.5 text-[11px] font-medium text-foreground-secondary shadow-sm transition-colors hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
          <GitBranch className="h-3.5 w-3.5" />
          {activeRows.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </span>
        <span aria-live="polite">
          {retainedRunCompleted
            ? t('composer:subagents.completed')
            : t('composer:subagents.working', { count: displayCount })}
        </span>
      </button>
      <ComposerAgentActivityPopover
        open={open}
        rows={visibleRows}
        composerAnchorRef={composerAnchorRef}
        triggerRef={triggerRef}
        onClose={close}
      />
    </div>
  )
}
