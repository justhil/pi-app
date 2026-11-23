import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { resolveVisibleDockPanels, useRightDockStore } from '@renderer/stores/right-dock-store'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'
import { RightPanelCollapsedRail } from '@renderer/components/app/right-panel-collapsed-rail'
import { isRightPanelHidden } from '@renderer/lib/right-panel-visibility'

const RIGHT_COLLAPSED_RAIL_PX = 40
const MIN_CENTER_GAP = 120
const MIN_SIDEBAR_PX = 200
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
  const rightPanelPrefs = useUIStore((s) => s.rightPanelPrefs)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)

  const bottomTabIds = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)

  const browserShowingInDock = useMemo(() => {
    const baseOrder = rightPanelOrder.length ? rightPanelOrder : rightPanelCatalog.map((c) => c.id)
    const enabledIds = baseOrder.filter((id) => rightPanelPrefs[id])
    const { topActive, bottomActive } = resolveVisibleDockPanels(enabledIds, activePanel, {
      bottomTabIds,
      topActive: dockTopActive,
      bottomActive: dockBottomActive,
    })
    return topActive === 'browser' || bottomActive === 'browser'
  }, [rightPanelOrder, rightPanelCatalog, rightPanelPrefs, activePanel, bottomTabIds, dockTopActive, dockBottomActive])

  const [leftDragging, setLeftDragging] = useState(false)
  const [rightDragging, setRightDragging] = useState(false)
  const leftDragRef = useRef(false)
  const rightDragRef = useRef(false)
  const setLeftWidth = useUIStore((s) => s.setSidebarWidth)
  const setRightWidth = useUIStore((s) => s.setRightPanelWidth)
  const setRightBrowserWidth = useUIStore((s) => s.setRightPanelBrowserWidth)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const zoom = Number(document.documentElement.style.zoom) || 1
      if (leftDragRef.current) setLeftWidth(e.clientX / zoom)
      if (rightDragRef.current) {
        const maxRight = Math.max(
          MIN_RIGHT_PANEL_PX,
          window.innerWidth / zoom - (leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : leftWidth) - MIN_CENTER_GAP,
        )
        const nextW = Math.min((window.innerWidth - e.clientX) / zoom, maxRight)
        if (browserShowingInDock) setRightBrowserWidth(nextW)
        else setRightWidth(nextW)
      }
    }
    const onUp = () => {
      if (leftDragRef.current || rightDragRef.current) {
        leftDragRef.current = false
        rightDragRef.current = false
        setLeftDragging(false)
        setRightDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setLeftWidth, setRightWidth, setRightBrowserWidth, leftCollapsed, leftWidth, browserShowingInDock])

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
    ((activePanel === 'files' && filesPreviewChatExpand) || (browserShowingInDock && browserChatExpand))
  const railPx = railIcons ? RIGHT_COLLAPSED_RAIL_PX : 0
  const preferredRightW = browserShowingInDock ? rightBrowserWidth : rightWidth
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
      data-browser-resizing={browserShowingInDock && (rightDragging || leftDragging) ? 'true' : undefined}
      className={cn(
        'shell-three-col min-h-0 flex-1',
        filesChatPreview && 'shell-files-chat-preview',
        leftDragging && 'shell-left-dragging',
        rightDragging && 'shell-right-dragging',
        rightCollapsed && !filesChatPreview && 'shell-right-rail-only',
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
        style={{ background: 'var(--bg-base)' }}
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
