import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X, type AppIconComponent } from '@renderer/components/icons'
import type { RightPanelCatalogItem } from '@shared/right-panels'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { SidePanelHost } from '@renderer/features/side-panels/side-panel-host'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  resolveVisibleDockPanels,
  useRightDockStore,
  type DockSlot,
} from '@renderer/stores/right-dock-store'

export interface RightDockTabItem {
  key: string
  label: string
  icon?: AppIconComponent
}

function SwapRowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 12V4m0 0L2.5 6.5M5 4l2.5 2.5M11 4v8m0 0l-2.5-2.5M11 12l2.5-2.5" />
    </svg>
  )
}

function SplitRowsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2 8h12" />
    </svg>
  )
}

interface TabStripProps {
  slot: DockSlot
  tabs: RightDockTabItem[]
  allTabs: RightDockTabItem[]
  activeKey: string
  isSplit: boolean
  canSplit: boolean
  dragTabId: string | null
  onSelect: (key: string) => void
  onDragStartTab: (key: string) => void
  onDragEndTab: () => void
  onDropTabOnStrip: (tabId: string, index?: number) => void
  onSplit: () => void
  onSwap: () => void
  onMerge: () => void
  onContextMenuTab: (e: React.MouseEvent, tabId: string, slot: DockSlot) => void
  onQuickJump: (panelId: string) => void
}

function DockTabStrip({
  slot,
  tabs,
  allTabs,
  activeKey,
  isSplit,
  canSplit,
  dragTabId,
  onSelect,
  onDragStartTab,
  onDragEndTab,
  onDropTabOnStrip,
  onSplit,
  onSwap,
  onMerge,
  onContextMenuTab,
  onQuickJump,
}: TabStripProps) {
  const { t } = useTranslation()
  const stripRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const update = () =>
      setEdges({
        start: strip.scrollLeft > 1,
        end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
      })
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToHorizontal(e, strip)
      if (dx === null) return
      e.preventDefault()
      strip.scrollLeft += dx
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(strip)
    strip.addEventListener('scroll', update, { passive: true })
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      strip.removeEventListener('scroll', update)
      strip.removeEventListener('wheel', onWheel)
    }
  }, [tabs.length])

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(
      `[data-panel-tab="${CSS.escape(activeKey)}"]`,
    )
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  return (
    <div
      data-dock-tabstrip={slot}
      className={cn(
        'right-panel-tabs-wrap flex shrink-0 items-center gap-0.5 border-b border-border/40 px-2',
        slot === 'top' ? 'h-11' : 'h-9 bg-[var(--bg-1)]/40',
      )}
      onDragOver={(e) => {
        if (!dragTabId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = dragTabId || e.dataTransfer.getData('text/x-pi-dock-tab')
        setOverIndex(null)
        if (id) onDropTabOnStrip(id, overIndex ?? undefined)
      }}
    >
      <div
        ref={stripRef}
        className={cn(
          'right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto',
          edges.start && 'right-panel-tabs-fade-start',
          edges.end && 'right-panel-tabs-fade-end',
        )}
        role="tablist"
      >
        {tabs.map((panel, index) => {
          const active = activeKey === panel.key
          const Icon = panel.icon
          const showInsertBefore = overIndex === index && dragTabId && dragTabId !== panel.key
          return (
            <div key={panel.key} className="relative flex shrink-0 items-center">
              {showInsertBefore ? (
                <span
                  className="pointer-events-none absolute -left-0.5 top-1 bottom-1 w-0.5 rounded-full bg-[var(--brand)]"
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                role="tab"
                draggable
                data-panel-tab={panel.key}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/x-pi-dock-tab', panel.key)
                  onDragStartTab(panel.key)
                }}
                onDragEnd={() => {
                  setOverIndex(null)
                  onDragEndTab()
                }}
                onDragOver={(e) => {
                  if (!dragTabId) return
                  e.preventDefault()
                  e.stopPropagation()
                  setOverIndex(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const id = dragTabId || e.dataTransfer.getData('text/x-pi-dock-tab')
                  setOverIndex(null)
                  if (id) onDropTabOnStrip(id, index)
                }}
                onContextMenu={(e) => onContextMenuTab(e, panel.key, slot)}
                onClick={() => onSelect(panel.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                  e.preventDefault()
                  const i = tabs.findIndex((p) => p.key === panel.key)
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                  onSelect(next.key)
                  stripRef.current
                    ?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(next.key)}"]`)
                    ?.focus()
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors',
                  slot === 'top' ? 'h-8' : 'h-7 text-[11.5px]',
                  active
                    ? 'bg-[var(--bg-active)] text-foreground'
                    : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                  dragTabId === panel.key && 'opacity-50',
                )}
              >
                {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" /> : null}
                <span>{panel.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      <div className="ml-0.5 flex shrink-0 items-center gap-0.5">
        {slot === 'top' && allTabs.length > 3 ? (
          <div className="relative">
            <button
              type="button"
              title={t('common:panel.quickJump')}
              aria-label={t('common:panel.quickJump')}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {pickerOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} aria-hidden />
                <div
                  role="menu"
                  data-browser-overlay=""
                  className="absolute right-0 top-7 z-50 w-[184px] rounded-lg border border-border/70 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
                >
                  {allTabs.map((item) => {
                    const Icon = item.icon
                    const inThisPane = tabs.some((x) => x.key === item.key)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setPickerOpen(false)
                          onQuickJump(item.key)
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                      >
                        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-75" /> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {isSplit ? (
                          <span className="text-[10px] text-muted-foreground">
                            {inThisPane ? t('common:panel.slotTop') : t('common:panel.slotBottom')}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {slot === 'top' && !isSplit && canSplit ? (
          <button
            type="button"
            data-testid="right-dock-split-btn"
            title={t('common:panel.splitDown')}
            aria-label={t('common:panel.splitDown')}
            onClick={onSplit}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <SplitRowsIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}

        {slot === 'bottom' && isSplit ? (
          <>
            <button
              type="button"
              title={t('common:panel.swapPanes')}
              aria-label={t('common:panel.swapPanes')}
              onClick={onSwap}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <SwapRowsIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="right-dock-merge-btn"
              title={t('common:panel.mergeSingle')}
              aria-label={t('common:panel.mergeSingle')}
              onClick={onMerge}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function RightDock({
  panels,
  catalog,
  rightPanelHidden,
  navSuppressed,
}: {
  panels: RightDockTabItem[]
  catalog: RightPanelCatalogItem[]
  rightPanelHidden: boolean
  navSuppressed: boolean
}) {
  const { t } = useTranslation()
  const activePanel = useUIStore((s) => s.activePanel)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)

  const bottomTabIds = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)
  const splitRatio = useRightDockStore((s) => s.splitRatio)
  const setSplitRatio = useRightDockStore((s) => s.setSplitRatio)
  const resetSplitRatio = useRightDockStore((s) => s.resetSplitRatio)
  const activateInSlot = useRightDockStore((s) => s.activateInSlot)
  const activatePanelSmart = useRightDockStore((s) => s.activatePanelSmart)
  const movePanel = useRightDockStore((s) => s.movePanel)
  const splitToBottom = useRightDockStore((s) => s.splitToBottom)
  const mergeToSingle = useRightDockStore((s) => s.mergeToSingle)
  const swapPanes = useRightDockStore((s) => s.swapPanes)
  const reconcile = useRightDockStore((s) => s.reconcile)
  const rememberWorkspace = useRightDockStore((s) => s.rememberWorkspace)
  const restoreWorkspace = useRightDockStore((s) => s.restoreWorkspace)

  const dockRef = useRef<HTMLDivElement>(null)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropZoneHover, setDropZoneHover] = useState(false)
  const [rowDragging, setRowDragging] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string; slot: DockSlot } | null>(null)

  const enabledIds = useMemo(() => panels.map((p) => p.key), [panels])
  const panelByKey = useMemo(() => new Map(panels.map((p) => [p.key, p])), [panels])
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  const { topIds, bottomIds, topActive, bottomActive } = useMemo(
    () =>
      resolveVisibleDockPanels(enabledIds, activePanel, {
        bottomTabIds,
        topActive: dockTopActive,
        bottomActive: dockBottomActive,
      }),
    [enabledIds, activePanel, bottomTabIds, dockTopActive, dockBottomActive],
  )

  const isSplit = bottomIds.length > 0
  const topTabs = useMemo(
    () => topIds.map((id) => panelByKey.get(id)).filter((x): x is RightDockTabItem => !!x),
    [topIds, panelByKey],
  )
  const bottomTabs = useMemo(
    () => bottomIds.map((id) => panelByKey.get(id)).filter((x): x is RightDockTabItem => !!x),
    [bottomIds, panelByKey],
  )

  useEffect(() => {
    reconcile(enabledIds, activePanel)
  }, [enabledIds, activePanel, reconcile])

  useEffect(() => {
    restoreWorkspace(currentWorkspace, enabledIds)
  }, [currentWorkspace])

  useEffect(() => {
    if (currentWorkspace) {
      rememberWorkspace(currentWorkspace, topActive, bottomActive)
    }
  }, [currentWorkspace, topActive, bottomActive, rememberWorkspace])

  useEffect(() => {
    if (!rowDragging) return
    document.body.setAttribute('data-browser-resizing', 'true')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    const onMove = (e: MouseEvent) => {
      const el = dockRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.height <= 120) return
      const next = (e.clientY - rect.top) / rect.height
      setSplitRatio(next)
    }
    const onUp = () => {
      setRowDragging(false)
      document.body.removeAttribute('data-browser-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.removeAttribute('data-browser-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [rowDragging, setSplitRatio])

  const topItem = catalogById.get(topActive)
  const bottomItem = bottomActive ? catalogById.get(bottomActive) : undefined
  const canDragCreateBottomSplit = !isSplit && Boolean(dragTabId) && topIds.length > 1

  const hidePanelFromPrefs = (panelId: string) => {
    if (enabledIds.length <= 1) return
    useUIStore.setState((s) => {
      const nextPrefs = { ...s.rightPanelPrefs, [panelId]: false }
      const nextActive = s.activePanel === panelId ? (enabledIds.find((x) => x !== panelId) ?? s.activePanel) : s.activePanel
      return { rightPanelPrefs: nextPrefs, activePanel: nextActive }
    })
  }

  return (
    <div ref={dockRef} data-pi-slot="right-dock" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        data-dock-pane="top"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={isSplit ? { flex: `${splitRatio} 1 0%` } : { flex: '1 1 0%' }}
      >
        <DockTabStrip
          slot="top"
          tabs={topTabs}
          allTabs={panels}
          activeKey={topActive}
          isSplit={isSplit}
          canSplit={enabledIds.length > 1}
          dragTabId={dragTabId}
          onSelect={(id) => activateInSlot('top', id, enabledIds)}
          onDragStartTab={setDragTabId}
          onDragEndTab={() => {
            setDragTabId(null)
            setDropZoneHover(false)
          }}
          onDropTabOnStrip={(id, idx) => {
            setDragTabId(null)
            setDropZoneHover(false)
            movePanel(id, 'top', enabledIds, idx)
          }}
          onSplit={() => splitToBottom(enabledIds)}
          onSwap={() => swapPanes(enabledIds)}
          onMerge={mergeToSingle}
          onContextMenuTab={(e, id, slot) => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY, tabId: id, slot })
          }}
          onQuickJump={(id) => activatePanelSmart(id, enabledIds)}
        />

        {!rightPanelHidden ? (
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            data-nav-suppress={navSuppressed ? 'true' : undefined}
          >
            <ErrorBoundary label="panel-top">
              <Suspense fallback={<EmptyState compact title={t('common:loading')} className="min-h-[8rem]" />}>
                <SidePanelHost item={topItem} />
              </Suspense>
            </ErrorBoundary>

            {canDragCreateBottomSplit ? (
              <div
                data-browser-overlay=""
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropZoneHover(true)
                }}
                onDragLeave={() => setDropZoneHover(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = dragTabId || e.dataTransfer.getData('text/x-pi-dock-tab')
                  setDragTabId(null)
                  setDropZoneHover(false)
                  if (id) movePanel(id, 'bottom', enabledIds)
                }}
                className={cn(
                  'absolute inset-x-2.5 bottom-2.5 top-1/2 z-40 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors backdrop-blur-[2px]',
                  dropZoneHover
                    ? 'border-[var(--brand)] bg-[var(--brand)]/14 text-foreground'
                    : 'border-border/80 bg-background/75 text-muted-foreground',
                )}
              >
                <SplitRowsIcon className="h-5 w-5" />
                <span className="text-[12px] font-medium">{t('common:panel.dropToSplitBottom')}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {isSplit && !rightPanelHidden ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            title={t('common:panel.doubleClickResetSplit')}
            onMouseDown={(e) => {
              e.preventDefault()
              setRowDragging(true)
            }}
            onDoubleClick={resetSplitRatio}
            className={cn(
              'group relative z-20 flex h-1.5 shrink-0 cursor-row-resize items-center justify-center border-y border-border/50 bg-[var(--bg-1)]/60 transition-colors hover:bg-[var(--brand)]/20',
              rowDragging && 'bg-[var(--brand)]/35',
            )}
          >
            <span className="h-0.5 w-7 rounded-full bg-border transition-colors group-hover:bg-[var(--brand)]" />
          </div>

          <div
            data-dock-pane="bottom"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={{ flex: `${1 - splitRatio} 1 0%` }}
          >
            <DockTabStrip
              slot="bottom"
              tabs={bottomTabs}
              allTabs={panels}
              activeKey={bottomActive || ''}
              isSplit={isSplit}
              canSplit={false}
              dragTabId={dragTabId}
              onSelect={(id) => activateInSlot('bottom', id, enabledIds)}
              onDragStartTab={setDragTabId}
              onDragEndTab={() => setDragTabId(null)}
              onDropTabOnStrip={(id, idx) => {
                setDragTabId(null)
                movePanel(id, 'bottom', enabledIds, idx)
              }}
              onSplit={() => {}}
              onSwap={() => swapPanes(enabledIds)}
              onMerge={mergeToSingle}
              onContextMenuTab={(e, id, slot) => {
                e.preventDefault()
                setCtxMenu({ x: e.clientX, y: e.clientY, tabId: id, slot })
              }}
              onQuickJump={(id) => activatePanelSmart(id, enabledIds)}
            />

            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              data-nav-suppress={navSuppressed ? 'true' : undefined}
            >
              <ErrorBoundary label="panel-bottom">
                <Suspense fallback={<EmptyState compact title={t('common:loading')} className="min-h-[8rem]" />}>
                  <SidePanelHost item={bottomItem} />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </>
      ) : null}

      {ctxMenu && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[120]" onClick={() => setCtxMenu(null)} aria-hidden />
              <div
                role="menu"
                data-browser-overlay=""
                style={{
                  left: Math.min(ctxMenu.x, window.innerWidth - 196),
                  top: Math.min(ctxMenu.y, window.innerHeight - 170),
                }}
                className="fixed z-[130] w-[186px] rounded-lg border border-border/70 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
              >
                {ctxMenu.slot === 'top' && topIds.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const id = ctxMenu.tabId
                      setCtxMenu(null)
                      movePanel(id, 'bottom', enabledIds)
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    {t('common:panel.moveToBottom')}
                  </button>
                ) : null}

                {ctxMenu.slot === 'bottom' ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const id = ctxMenu.tabId
                      setCtxMenu(null)
                      movePanel(id, 'top', enabledIds)
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    {t('common:panel.moveToTop')}
                  </button>
                ) : null}

                {isSplit ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCtxMenu(null)
                        swapPanes(enabledIds)
                      }}
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      {t('common:panel.swapPanes')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCtxMenu(null)
                        mergeToSingle()
                      }}
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      {t('common:panel.mergeSingle')}
                    </button>
                  </>
                ) : null}

                {enabledIds.length > 1 ? (
                  <>
                    <div className="my-1 h-px bg-border/60" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const id = ctxMenu.tabId
                        setCtxMenu(null)
                        hidePanelFromPrefs(id)
                      }}
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                    >
                      {t('common:panel.hidePanel')}
                    </button>
                  </>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
