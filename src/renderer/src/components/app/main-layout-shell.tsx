import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { isStageRightPanelId } from '@shared/right-panels'
import { useUIStore } from '@renderer/stores/ui-store'
import { resolveOpenTabIds, resolveVisibleDockPanels, useRightDockStore } from '@renderer/stores/right-dock-store'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'
import { RightPanelCollapsedRail } from '@renderer/components/app/right-panel-collapsed-rail'
import { isRightPanelHidden } from '@renderer/lib/right-panel-visibility'

const RIGHT_COLLAPSED_RAIL_PX = 40
const MIN_CENTER_GAP = 120
const MIN_SIDEBAR_PX = 200
const SIDEBAR_DRAG_COLLAPSE_PX = 64
const SIDEBAR_DRAG_REOPEN_PX = 100
const MIN_RIGHT_PANEL_PX = 280

export function MainLayoutShell({
  left,
  center,
  right,
  bottom,
  bottomOpen = false,
  bottomHeight = 0,
}: {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  bottom?: ReactNode
  bottomOpen?: boolean
  bottomHeight?: number
}) {
  const leftCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const leftWidth = useUIStore((s) => s.sidebarWidth)
  const rightCollapsedPref = useUIStore((s) => s.rightPanelCollapsed)
  const rightExpandedOnNarrow = useUIStore((s) => s.rightPanelExpandedOnNarrow)
  const rightWidth = useUIStore((s) => s.rightPanelWidth)
  const rightBrowserWidth = useUIStore((s) => s.rightPanelBrowserWidth)
  const railIcons = useUIStore((s) => s.rightPanelRailIcons)
  const activePanel = useUIStore((s) => s.activePanel)
  const rightPanelCatalog = useUIStore((s) => s.rightPanelCatalog)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)
  const canvasChatExpand = useUIStore((s) => s.canvasChatExpand)

  const openTabIds = useRightDockStore((s) => s.openTabIds)
  const bottomTabIds = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)

  const { browserShowingInDock, stageShowingInDock } = useMemo(() => {
    const baseOrder = rightPanelOrder.length ? rightPanelOrder : rightPanelCatalog.map((c) => c.id)
    const catalogIds = rightPanelCatalog.map((c) => c.id)
    const availableIds = [...baseOrder, ...catalogIds.filter((id) => !baseOrder.includes(id))]
    const openIds = resolveOpenTabIds(availableIds, openTabIds)
    const { topActive, bottomActive } = resolveVisibleDockPanels(openIds, activePanel, {
      bottomTabIds,
      topActive: dockTopActive,
      bottomActive: dockBottomActive,
    })
    return {
      browserShowingInDock: topActive === 'browser' || bottomActive === 'browser',
      stageShowingInDock: isStageRightPanelId(topActive) || isStageRightPanelId(bottomActive),
    }
  }, [rightPanelOrder, rightPanelCatalog, openTabIds, activePanel, rightCollapsedPref, bottomTabIds, dockTopActive, dockBottomActive])

  const [leftDragging, setLeftDragging] = useState(false)
  const [rightDragging, setRightDragging] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const leftDragRef = useRef(false)
  const leftDragStartWidthRef = useRef(leftWidth)
  const leftDragCollapsedRef = useRef(false)
  const rightDragRef = useRef(false)
  const setLeftWidth = useUIStore((s) => s.setSidebarWidth)
  const setLeftCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const setRightWidth = useUIStore((s) => s.setRightPanelWidth)
  const setRightBrowserWidth = useUIStore((s) => s.setRightPanelBrowserWidth)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const zoom = Number(document.documentElement.style.zoom) || 1
      const shellRect = shellRef.current?.getBoundingClientRect()
      const leftOrigin = shellRect ? shellRect.left : 0
      const rightEdge = shellRect ? shellRect.right : window.innerWidth
      const availableW = (shellRect && shellRect.width > 0 ? shellRect.width : window.innerWidth) / zoom
      if (leftDragRef.current) {
        const rawLeftW = (e.clientX - leftOrigin) / zoom
        if (!leftDragCollapsedRef.current && rawLeftW < SIDEBAR_DRAG_COLLAPSE_PX) {
          leftDragCollapsedRef.current = true
          setLeftCollapsed(true)
        } else if (leftDragCollapsedRef.current && rawLeftW >= SIDEBAR_DRAG_REOPEN_PX) {
          leftDragCollapsedRef.current = false
          setLeftCollapsed(false)
          setLeftWidth(rawLeftW)
        } else if (!leftDragCollapsedRef.current) {
          setLeftWidth(rawLeftW)
        }
      }
      if (rightDragRef.current) {
        const maxRight = Math.max(
          MIN_RIGHT_PANEL_PX,
          availableW - (leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : leftWidth) - MIN_CENTER_GAP,
        )
        const nextW = Math.min((rightEdge - e.clientX) / zoom, maxRight)
        if (stageShowingInDock) setRightBrowserWidth(nextW)
        else setRightWidth(nextW)
      }
    }
    const onUp = () => {
      if (leftDragRef.current || rightDragRef.current) {
        if (leftDragRef.current && leftDragCollapsedRef.current) {
          setLeftWidth(leftDragStartWidthRef.current)
        }
        leftDragRef.current = false
        leftDragCollapsedRef.current = false
        rightDragRef.current = false
        setLeftDragging(false)
        setRightDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [setLeftWidth, setLeftCollapsed, setRightWidth, setRightBrowserWidth, leftCollapsed, leftWidth, stageShowingInDock])

  const [{ width: windowWidth, zoom }, setWindowMetrics] = useState(() => ({
    width: window.innerWidth,
    zoom: Number(document.documentElement.style.zoom) || 1,
  }))
  useEffect(() => {
    const onWindowResize = () =>
      setWindowMetrics({
        width: window.innerWidth,
        zoom: Number(document.documentElement.style.zoom) || 1,
      })
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])
  const layoutWidth = windowWidth / zoom

  const maxLeftFor = (w: number): number => Math.max(MIN_SIDEBAR_PX, Math.round(w * 0.4))
  const effectiveLeft = leftCollapsed ? 0 : Math.min(leftWidth, maxLeftFor(layoutWidth))
  const leftColW = leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : effectiveLeft
  const maxRight = Math.max(MIN_RIGHT_PANEL_PX, layoutWidth - leftColW - MIN_CENTER_GAP)
  const rightCollapsed = isRightPanelHidden({
    collapsed: rightCollapsedPref,
    expandedOnNarrow: rightExpandedOnNarrow,
    windowWidth,
  })
  const filesChatPreview =
    !rightCollapsed &&
    ((activePanel === 'files' && filesPreviewChatExpand) || browserChatExpand || canvasChatExpand)
  const railPx = railIcons ? RIGHT_COLLAPSED_RAIL_PX : 0
  const preferredRightW = stageShowingInDock ? rightBrowserWidth : rightWidth
  const effectiveRight = rightCollapsed
    ? railPx
    : Math.min(preferredRightW, maxRight, Math.max(0, layoutWidth - effectiveLeft))

  const leftCol = leftCollapsed ? '0px' : `${effectiveLeft}px`
  const rightCol = rightCollapsed ? `${railPx}px` : `${effectiveRight}px`
  const gridCols = filesChatPreview
    ? `${leftCol} 0px minmax(0, 1fr)`
    : `${leftCol} minmax(0, 1fr) ${rightCol}`

  const startLeftDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    leftDragStartWidthRef.current = useUIStore.getState().sidebarWidth
    leftDragCollapsedRef.current = false
    leftDragRef.current = true
    setLeftDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const startRightDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    rightDragRef.current = true
    setRightDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      ref={shellRef}
      data-browser-resizing={browserShowingInDock && (rightDragging || leftDragging) ? 'true' : undefined}
      className={cn(
        'shell-three-col min-h-0 flex-1',
        filesChatPreview && 'shell-files-chat-preview',
        leftDragging && 'shell-left-dragging',
        rightDragging && 'shell-right-dragging',
        rightCollapsed && !filesChatPreview && (railIcons ? 'shell-right-rail-only' : 'shell-right-hidden-clean'),
      )}
      style={{
        gridTemplateColumns: gridCols,
        ...(bottom ? { gridTemplateRows: `minmax(0, 1fr) ${bottomOpen ? Math.round(bottomHeight) : 0}px` } : {}),
      }}
    >
      <div
        className={cn(
          'shell-track-left relative flex min-w-0 flex-row items-stretch overflow-hidden',
          leftCollapsed && 'shell-track-collapsed',
        )}
        style={{ background: 'var(--surface-sidebar)', ...(bottom ? { gridRow: '1 / span 2' } : {}) }}
        aria-hidden={leftCollapsed}
      >
        <div
          className={cn(
            'shell-track-inner h-full min-h-0 min-w-0 flex-1',
            leftCollapsed && 'pointer-events-none',
          )}
        >
          {left}
        </div>
        {!leftCollapsed && (
          <PanelResizeEdge side="left" dragging={leftDragging} onMouseDown={startLeftDrag} />
        )}
      </div>

      <div
        className={cn(
          'shell-track-center min-w-0',
          filesChatPreview && 'pointer-events-none',
        )}
        style={filesChatPreview ? { visibility: 'hidden' as const } : undefined}
        aria-hidden={filesChatPreview}
      >
        {center}
      </div>

      <div
        className={cn(
          'shell-track-right relative flex min-w-0 flex-row items-stretch overflow-visible',
          rightCollapsed && 'shell-track-right-rail',
        )}
        style={{ background: rightCollapsed ? 'var(--surface-sidebar)' : 'var(--bg-base)' }}
      >
        {!rightCollapsed && !filesChatPreview ? (
          <PanelResizeEdge side="right" dragging={rightDragging} onMouseDown={startRightDrag} />
        ) : null}
        {rightCollapsed && !filesChatPreview ? (
          railIcons ? <RightPanelCollapsedRail /> : null
        ) : (
          <div className="shell-track-inner flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {right}
          </div>
        )}
      </div>

      {bottom ? (
        <div
          className={cn('shell-track-bottom min-h-0 min-w-0 overflow-hidden', !bottomOpen && 'invisible')}
          style={{ gridColumn: '2 / span 2', gridRow: 2 }}
        >
          {bottom}
        </div>
      ) : null}
    </div>
  )
}
