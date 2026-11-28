import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Maximize2, PanelRight, Plus, X, type AppIconComponent } from '@renderer/components/icons'
import { isStageRightPanelId, type RightPanelCatalogItem } from '@shared/right-panels'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { SidePanelHost } from '@renderer/features/side-panels/side-panel-host'
import { RightDockLaunchpad } from '@renderer/features/shell/right-dock-launchpad'
import {
  useAnchoredMenuPosition,
  useContextMenuPosition,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  resolveOpenTabIds,
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
  allAvailableTabs: RightDockTabItem[]
  openIdSet: ReadonlySet<string>
  activeKey: string
  isSplit: boolean
  canSplit: boolean
  showingLaunchpad: boolean
  expanded: boolean
  dragTabId: string | null
  onSelect: (key: string) => void
  onCloseTab: (key: string) => void
  onOpenFromMenu: (panelId: string) => void
  onToggleLaunchpad: () => void
  onCloseLaunchpad: () => void
  onToggleExpand: () => void
  onCollapseRightPanel: () => void
  onDragStartTab: (key: string) => void
  onDragEndTab: () => void
  onDropTabOnStrip: (tabId: string, index?: number) => void
  onSplit: () => void
  onSwap: () => void
  onMerge: () => void
  onContextMenuTab: (e: React.MouseEvent, tabId: string, slot: DockSlot) => void
}

function DockTabStrip({
  slot,
  tabs,
  allAvailableTabs,
  openIdSet,
  activeKey,
  isSplit,
  canSplit,
  showingLaunchpad,
  expanded,
  dragTabId,
  onSelect,
  onCloseTab,
  onOpenFromMenu,
  onToggleLaunchpad,
  onCloseLaunchpad,
  onToggleExpand,
  onCollapseRightPanel,
  onDragStartTab,
  onDragEndTab,
  onDropTabOnStrip,
  onSplit,
  onSwap,
  onMerge,
  onContextMenuTab,
}: TabStripProps) {
  const { t } = useTranslation()
  const stripRef = useRef<HTMLDivElement>(null)
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const pickerMenuRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useDismissContextMenu(pickerOpen, pickerMenuRef, () => setPickerOpen(false), pickerBtnRef)
  const pickerPos = useAnchoredMenuPosition(pickerOpen, pickerBtnRef, pickerMenuRef, { align: 'end', gap: 6 })

  const stageItems = useMemo(
    () => allAvailableTabs.filter((item) => isStageRightPanelId(item.key)),
    [allAvailableTabs],
  )
  const inspectorItems = useMemo(
    () => allAvailableTabs.filter((item) => !isStageRightPanelId(item.key)),
    [allAvailableTabs],
  )

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
    if (!activeKey) return
    const el = stripRef.current?.querySelector<HTMLElement>(
      `[data-panel-tab="${CSS.escape(activeKey)}"]`,
    )
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  const renderMenuGroup = (title: string, items: RightDockTabItem[]) => {
    if (items.length === 0) return null
    return (
      <div>
        <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {title}
        </div>
        {items.map((item) => {
          const Icon = item.icon
          const isOpen = openIdSet.has(item.key)
          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setPickerOpen(false)
                onOpenFromMenu(item.key)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-75" /> : null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {isOpen ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-[var(--brand)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                  {t('common:panel.opened')}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  const tabStyle = useUIStore((s) => s.uiCustomization.shellRightTabStyle)

  return (
    <div
      data-pi-slot={slot === 'top' ? 'right-dock-tabs' : undefined}
      data-dock-tabstrip={slot}
      data-tab-style={tabStyle}
      className={cn(
        'right-panel-tabs-wrap flex shrink-0 items-center gap-2 bg-[var(--bg-base)] px-3',
        slot === 'top' ? 'h-12' : 'h-9',
      )}
      style={slot === 'bottom' ? { borderTop: '1px solid var(--shell-hairline)' } : undefined}
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
          const isStage = isStageRightPanelId(panel.key)
          return (
            <div
              key={panel.key}
              className="relative flex shrink-0 items-center"
              onMouseDown={(e) => {
                // Prevent browser auto-scroll icon on middle-click so auxClick cleanly closes the tab.
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                e.stopPropagation()
                onCloseTab(panel.key)
              }}
            >
              {showInsertBefore ? (
                <span
                  className="pointer-events-none absolute -left-0.5 top-1 bottom-1 w-0.5 rounded-full bg-[var(--brand)]"
                  aria-hidden
                />
              ) : null}
              <div
                draggable
                data-panel-tab={panel.key}
                data-panel-group={isStage ? 'stage' : 'inspector'}
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
                title={`${panel.label} · ${t('common:panel.closeTab')}`}
                className={cn(
                  'group relative inline-flex shrink-0 items-center gap-1.5 pl-2.5 pr-1.5 text-[13px] whitespace-nowrap transition-colors',
                  slot === 'top' ? 'h-8' : 'h-6 text-[12px]',
                  tabStyle === 'underline'
                    ? cn(
                        'rounded-none border-b-2',
                        active
                          ? 'border-[var(--brand)] font-medium text-foreground'
                          : 'border-transparent text-foreground-secondary/75 hover:text-foreground',
                      )
                    : tabStyle === 'minimal'
                      ? cn(
                          'rounded-md',
                          active
                            ? 'font-semibold text-foreground'
                            : 'text-foreground-secondary/70 hover:text-foreground',
                        )
                      : cn(
                          'rounded-lg',
                          active
                            ? 'bg-foreground/[0.055] font-medium text-foreground'
                            : 'text-foreground-secondary/75 hover:bg-foreground/[0.035] hover:text-foreground',
                        ),
                  dragTabId === panel.key && 'opacity-50',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelect(panel.key)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                    e.preventDefault()
                    const i = tabs.findIndex((p) => p.key === panel.key)
                    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                    onSelect(next.key)
                    stripRef.current
                      ?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(next.key)}"] [role="tab"]`)
                      ?.focus()
                  }}
                  className="inline-flex h-full items-center gap-1.5 outline-none"
                >
                  {Icon ? (
                    <Icon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        isStage && active ? 'text-[var(--brand)]' : 'opacity-75',
                      )}
                    />
                  ) : null}
                  <span>{panel.label}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('common:panel.closeTab')}
                  title={t('common:panel.closeTab')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(panel.key)
                  }}
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-[var(--bg-hover)] hover:text-foreground',
                    active ? 'opacity-50 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
                  )}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          )
        })}

        {slot === 'top' ? (
          tabs.length === 0 || showingLaunchpad ? (
            <div
              data-testid="right-dock-new-tab-pill"
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                onCloseLaunchpad()
              }}
              className="flex h-8 max-w-[260px] flex-1 items-center justify-between gap-2 rounded-lg bg-foreground/[0.05] pl-2.5 pr-2 text-[13px] font-medium text-foreground/90"
            >
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 opacity-75" strokeWidth={1.7} />
                <span className="truncate">{t('common:panel.newTab')}</span>
              </button>
              <button
                type="button"
                aria-label={t('common:panel.closeTab')}
                title={t('common:panel.closeTab')}
                onClick={onCloseLaunchpad}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-foreground-secondary/65 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="relative shrink-0">
              <button
                ref={pickerBtnRef}
                type="button"
                data-testid="right-dock-open-tab-btn"
                title={t('common:panel.newTab')}
                aria-label={t('common:panel.newTab')}
                onClick={onToggleLaunchpad}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setPickerOpen((v) => !v)
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
              </button>
            </div>
          )
        ) : null}

        {slot === 'top' && pickerOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={pickerMenuRef}
                role="menu"
                data-browser-overlay=""
                style={pickerPos}
                onPointerDown={(e) => e.stopPropagation()}
                className="electron-no-drag fixed z-[500] w-[210px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-border/65 bg-popover p-1.5 text-[12px] text-popover-foreground shadow-xl"
              >
                {renderMenuGroup(t('common:panel.stageGroup'), stageItems)}
                {stageItems.length > 0 && inspectorItems.length > 0 ? (
                  <div className="my-1 h-px bg-border/50" />
                ) : null}
                {renderMenuGroup(t('common:panel.inspectorGroup'), inspectorItems)}
              </div>,
              document.body,
            )
          : null}
      </div>

      <div className="ml-0.5 flex shrink-0 items-center gap-0.5">
        {slot === 'top' && !isSplit && canSplit && !showingLaunchpad ? (
          <button
            type="button"
            data-testid="right-dock-split-btn"
            title={t('common:panel.splitDown')}
            aria-label={t('common:panel.splitDown')}
            onClick={onSplit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <SplitRowsIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}

        {slot === 'top' ? (
          <>
            <button
              type="button"
              onClick={onToggleExpand}
              aria-pressed={expanded}
              title={expanded ? t('common:panel.exitFullWidth') : t('common:panel.fullWidth')}
              aria-label={expanded ? t('common:panel.exitFullWidth') : t('common:panel.fullWidth')}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                expanded
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.65} />
            </button>
            <button
              type="button"
              data-right-panel-toggle=""
              onClick={onCollapseRightPanel}
              title={t('common:topbar.collapseRightPanel')}
              aria-label={t('common:topbar.collapseRightPanel')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary/80 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <PanelRight className="h-4 w-4" strokeWidth={1.65} />
            </button>
          </>
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

  const openTabIds = useRightDockStore((s) => s.openTabIds)
  const bottomTabIds = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)
  const launchpadOpen = useRightDockStore((s) => s.launchpadOpen)
  const setLaunchpadOpen = useRightDockStore((s) => s.setLaunchpadOpen)
  const splitRatio = useRightDockStore((s) => s.splitRatio)
  const setSplitRatio = useRightDockStore((s) => s.setSplitRatio)
  const resetSplitRatio = useRightDockStore((s) => s.resetSplitRatio)
  const activateInSlot = useRightDockStore((s) => s.activateInSlot)
  const openTab = useRightDockStore((s) => s.openTab)
  const closeTab = useRightDockStore((s) => s.closeTab)
  const closeOtherTabs = useRightDockStore((s) => s.closeOtherTabs)
  const closeAllTabs = useRightDockStore((s) => s.closeAllTabs)
  const movePanel = useRightDockStore((s) => s.movePanel)
  const splitToBottom = useRightDockStore((s) => s.splitToBottom)
  const mergeToSingle = useRightDockStore((s) => s.mergeToSingle)
  const swapPanes = useRightDockStore((s) => s.swapPanes)
  const reconcile = useRightDockStore((s) => s.reconcile)
  const rememberWorkspace = useRightDockStore((s) => s.rememberWorkspace)
  const restoreWorkspace = useRightDockStore((s) => s.restoreWorkspace)

  const dockRef = useRef<HTMLDivElement>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropZoneHover, setDropZoneHover] = useState(false)
  const [rowDragging, setRowDragging] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string; slot: DockSlot } | null>(null)
  useDismissContextMenu(!!ctxMenu, ctxMenuRef, () => setCtxMenu(null))
  const ctxMenuPos = useContextMenuPosition(ctxMenu, ctxMenuRef, [ctxMenu?.tabId, openTabIds.length])
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)
  const canvasChatExpand = useUIStore((s) => s.canvasChatExpand)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)

  const availableIds = useMemo(() => panels.map((p) => p.key), [panels])
  const panelByKey = useMemo(() => new Map(panels.map((p) => [p.key, p])), [panels])
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  const openIds = useMemo(
    () => resolveOpenTabIds(availableIds, openTabIds),
    [availableIds, openTabIds],
  )
  const openIdSet = useMemo(() => new Set(openIds), [openIds])
  const showingLaunchpad = openIds.length === 0 || launchpadOpen

  const { topIds, bottomIds, topActive, bottomActive } = useMemo(
    () =>
      resolveVisibleDockPanels(openIds, activePanel, {
        bottomTabIds,
        topActive: dockTopActive,
        bottomActive: dockBottomActive,
      }),
    [openIds, activePanel, bottomTabIds, dockTopActive, dockBottomActive],
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
    reconcile(availableIds, activePanel)
  }, [availableIds, activePanel, reconcile])

  const prevActivePanelRef = useRef(activePanel)
  useEffect(() => {
    const activeChanged = prevActivePanelRef.current !== activePanel
    prevActivePanelRef.current = activePanel
    if (!activeChanged || rightPanelHidden || !activePanel) return
    if (useUIStore.getState().rightPanelCollapsed) return
    if (!availableIds.includes(activePanel)) return
    setLaunchpadOpen(false)
    if (!openTabIds.includes(activePanel)) {
      openTab(activePanel, { focus: false })
    }
  }, [rightPanelHidden, activePanel, availableIds, openTabIds, openTab])

  useEffect(() => {
    restoreWorkspace(currentWorkspace, availableIds)
  }, [currentWorkspace])

  useEffect(() => {
    if (currentWorkspace && topActive) {
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

  const topItem = topActive ? catalogById.get(topActive) : undefined
  const bottomItem = bottomActive ? catalogById.get(bottomActive) : undefined
  const canDragCreateBottomSplit = !isSplit && Boolean(dragTabId) && topIds.length > 1
  const dockExpanded = Boolean(browserChatExpand || canvasChatExpand || filesPreviewChatExpand)

  const handleToggleDockExpand = () => {
    if (topActive === 'files') {
      useUIStore.setState((s) => ({
        filesPreviewChatExpand: !s.filesPreviewChatExpand,
        browserChatExpand: false,
        canvasChatExpand: false,
      }))
    } else if (topActive === 'canvas') {
      useUIStore.setState((s) => ({
        canvasChatExpand: !s.canvasChatExpand,
        browserChatExpand: false,
        filesPreviewChatExpand: false,
      }))
    } else {
      useUIStore.setState((s) => ({
        browserChatExpand: !s.browserChatExpand,
        canvasChatExpand: false,
        filesPreviewChatExpand: false,
      }))
    }
  }

  const handleCollapseRightPanel = () => {
    setLaunchpadOpen(false)
    useUIStore.setState({
      rightPanelCollapsed: true,
      rightPanelExpandedOnNarrow: false,
      browserChatExpand: false,
      canvasChatExpand: false,
      filesPreviewChatExpand: false,
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
          allAvailableTabs={panels}
          openIdSet={openIdSet}
          activeKey={showingLaunchpad ? '' : topActive}
          isSplit={isSplit}
          canSplit={openIds.length > 1}
          showingLaunchpad={showingLaunchpad}
          expanded={dockExpanded}
          dragTabId={dragTabId}
          onSelect={(id) => {
            setLaunchpadOpen(false)
            activateInSlot('top', id, openIds)
          }}
          onCloseTab={(id) => {
            closeTab(id)
          }}
          onOpenFromMenu={(id) => {
            setLaunchpadOpen(false)
            openTab(id, { focus: true })
          }}
          onToggleLaunchpad={() => setLaunchpadOpen(true)}
          onCloseLaunchpad={() => {
            if (openIds.length > 0) setLaunchpadOpen(false)
            else handleCollapseRightPanel()
          }}
          onToggleExpand={handleToggleDockExpand}
          onCollapseRightPanel={handleCollapseRightPanel}
          onDragStartTab={setDragTabId}
          onDragEndTab={() => {
            setDragTabId(null)
            setDropZoneHover(false)
          }}
          onDropTabOnStrip={(id, idx) => {
            setDragTabId(null)
            setDropZoneHover(false)
            movePanel(id, 'top', openIds, idx)
          }}
          onSplit={() => splitToBottom(openIds)}
          onSwap={() => swapPanes(openIds)}
          onMerge={mergeToSingle}
          onContextMenuTab={(e, id, slot) => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY, tabId: id, slot })
          }}
        />

        {!rightPanelHidden ? (
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            data-nav-suppress={navSuppressed ? 'true' : undefined}
          >
            {showingLaunchpad ? (
              <RightDockLaunchpad
                allAvailableTabs={panels}
                onOpenPanel={(panelId) => {
                  setLaunchpadOpen(false)
                  openTab(panelId, { focus: true })
                }}
              />
            ) : (
              <ErrorBoundary label="panel-top">
                <Suspense fallback={<EmptyState compact title={t('common:loading')} className="min-h-[8rem]" />}>
                  <SidePanelHost item={topItem} />
                </Suspense>
              </ErrorBoundary>
            )}

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
                  if (id) movePanel(id, 'bottom', openIds)
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
              allAvailableTabs={panels}
              openIdSet={openIdSet}
              activeKey={bottomActive || ''}
              isSplit={isSplit}
              canSplit={false}
              showingLaunchpad={false}
              expanded={false}
              dragTabId={dragTabId}
              onSelect={(id) => activateInSlot('bottom', id, openIds)}
              onCloseTab={(id) => closeTab(id)}
              onOpenFromMenu={(id) => openTab(id, { slot: 'bottom', focus: true })}
              onToggleLaunchpad={() => {}}
              onCloseLaunchpad={() => {}}
              onToggleExpand={() => {}}
              onCollapseRightPanel={() => {}}
              onDragStartTab={setDragTabId}
              onDragEndTab={() => setDragTabId(null)}
              onDropTabOnStrip={(id, idx) => {
                setDragTabId(null)
                movePanel(id, 'bottom', openIds, idx)
              }}
              onSplit={() => {}}
              onSwap={() => swapPanes(openIds)}
              onMerge={mergeToSingle}
              onContextMenuTab={(e, id, slot) => {
                e.preventDefault()
                setCtxMenu({ x: e.clientX, y: e.clientY, tabId: id, slot })
              }}
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
            <div
              ref={ctxMenuRef}
              role="menu"
              data-browser-overlay=""
              style={ctxMenuPos}
              onPointerDown={(e) => e.stopPropagation()}
              className="electron-no-drag fixed z-[500] w-[186px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border/70 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
            >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const id = ctxMenu.tabId
                    setCtxMenu(null)
                    closeTab(id)
                  }}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                >
                  {t('common:panel.closeTab')}
                </button>
                {openIds.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const id = ctxMenu.tabId
                      setCtxMenu(null)
                      closeOtherTabs(id)
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    {t('common:panel.closeOthers')}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCtxMenu(null)
                    closeAllTabs()
                  }}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  {t('common:panel.closeAll')}
                </button>

                {openIds.length > 1 ? <div className="my-1 h-px bg-border/60" /> : null}

                {ctxMenu.slot === 'top' && topIds.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const id = ctxMenu.tabId
                      setCtxMenu(null)
                      movePanel(id, 'bottom', openIds)
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
                      movePanel(id, 'top', openIds)
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
                        swapPanes(openIds)
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
              </div>,
            document.body,
          )
        : null}
    </div>
  )
}
