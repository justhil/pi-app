import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'
import { RightPanelCollapsedRail } from '@renderer/components/app/right-panel-collapsed-rail'
import { isRightPanelHidden } from '@renderer/lib/right-panel-visibility'

/** Collapsed right rail width — keep in sync with RightPanelCollapsedRail (w-10 = 40px) */
const RIGHT_COLLAPSED_RAIL_PX = 40

/** Minimum width the center column keeps next to a panel while dragging / resizing the window. */
const MIN_CENTER_GAP = 120

/** Minimum panel widths (mirror the clamps in ui-store-shell-slice). */
const MIN_SIDEBAR_PX = 200
const MIN_RIGHT_PANEL_PX = 280

/**
 * 三栏 Grid：侧栏用 0fr ↔ 固定宽 过渡，中间列 1fr 由浏览器插值，避免 width 动画每帧重排 Timeline。
 * Cursor UI 实验：右栏收起时保留窄 icon rail（状态点 + 面板入口），不完全消失。
 */
export function MainLayoutShell({
  left,
  center,
  right,
  browserStage,
  bottom,
  bottomOpen = false,
  bottomHeight = 0,
}: {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  /** First-class non-intrusive Browser Stage (Left Chat + Right Browser 5:5 / 3:7 / full). */
  browserStage?: ReactNode
  /** Drawer under the center and right columns (built-in terminal); kept mounted while closed. */
  bottom?: ReactNode
  bottomOpen?: boolean
  bottomHeight?: number
}) {
  const leftCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const leftWidth = useUIStore((s) => s.sidebarWidth)
  const rightCollapsedPref = useUIStore((s) => s.rightPanelCollapsed)
  const rightExpandedOnNarrow = useUIStore((s) => s.rightPanelExpandedOnNarrow)
  const rightWidth = useUIStore((s) => s.rightPanelWidth)
  const railIcons = useUIStore((s) => s.rightPanelRailIcons)
  const activePanel = useUIStore((s) => s.activePanel)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)
  const browserStageMode = useUIStore((s) => s.browserStageMode)
  const browserStageRatio = useUIStore((s) => s.browserStageRatio)
  const setBrowserStageRatio = useUIStore((s) => s.setBrowserStageRatio)

  const [leftDragging, setLeftDragging] = useState(false)
  const [rightDragging, setRightDragging] = useState(false)
  const leftDragRef = useRef(false)
  const rightDragRef = useRef(false)
  const setLeftWidth = useUIStore((s) => s.setSidebarWidth)
  const setRightWidth = useUIStore((s) => s.setRightPanelWidth)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const zoom = Number(document.documentElement.style.zoom) || 1
      if (leftDragRef.current) setLeftWidth(e.clientX / zoom)
      if (rightDragRef.current) {
        const leftColW = leftCollapsed ? 0 : leftWidth
        const avail = Math.max(400, window.innerWidth / zoom - leftColW)
        if (browserStageMode !== 'closed' && browserStageMode !== 'full') {
          const desiredBrowserW = (window.innerWidth - e.clientX) / zoom
          setBrowserStageRatio(desiredBrowserW / avail)
        } else {
          const maxRight = Math.max(MIN_RIGHT_PANEL_PX, window.innerWidth / zoom - (leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : leftWidth) - MIN_CENTER_GAP)
          setRightWidth(Math.min((window.innerWidth - e.clientX) / zoom, maxRight))
        }
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
  }, [setLeftWidth, setRightWidth, setBrowserStageRatio, leftCollapsed, leftWidth, browserStageMode])

  // Adapt persisted panel widths when the window is resized: the columns are fixed px from the
  // store, so without this they either overflow the window (center collapses to 0) on smaller
  // windows or stay disproportionately small on larger ones.
  // 注意：窗口缩小只是“临时生效的展示值”，不得写回持久化首选宽度——否则缩小一次就永久
  // 丢失用户设置（放大后无法恢复）。resize 只触发重渲染，实际 clamp 在渲染时实时计算。
  const [{ width: windowWidth, zoom }, setWindowMetrics] = useState(() => ({
    width: window.innerWidth,
    zoom: Number(document.documentElement.style.zoom) || 1,
  }))
  useEffect(() => {
    const onWindowResize = () => setWindowMetrics({
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
  const stageOpen = Boolean(browserStage) && browserStageMode !== 'closed'
  const stageFull = stageOpen && browserStageMode === 'full'
  const filesChatPreview =
    stageFull ||
    (!stageOpen &&
      !rightCollapsed &&
      ((activePanel === 'files' && filesPreviewChatExpand) || (activePanel === 'browser' && browserChatExpand)))
  const railPx = railIcons ? RIGHT_COLLAPSED_RAIL_PX : 0
  const stageAvail = Math.max(360, layoutWidth - effectiveLeft)
  const effectiveStageW = Math.round(
    Math.min(
      Math.max(360, stageAvail * browserStageRatio),
      Math.max(360, stageAvail - 320),
    ),
  )
  const effectiveRight = stageOpen
    ? effectiveStageW
    : rightCollapsed
      ? railPx
      : Math.min(rightWidth, maxRight, Math.max(0, layoutWidth - effectiveLeft))

  const leftCol = leftCollapsed ? '0px' : `${effectiveLeft}px`
  const rightCol = stageOpen ? `${effectiveStageW}px` : rightCollapsed ? `${railPx}px` : `${effectiveRight}px`
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
      data-browser-resizing={stageOpen && (rightDragging || leftDragging) ? 'true' : undefined}
      className={cn(
        'shell-three-col min-h-0 flex-1',
        filesChatPreview && 'shell-files-chat-preview',
        leftDragging && 'shell-left-dragging',
        rightDragging && 'shell-right-dragging',
        !stageOpen && rightCollapsed && !filesChatPreview && 'shell-right-rail-only',
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
          !stageOpen && rightCollapsed && 'shell-track-right-rail',
        )}
        style={{ background: 'var(--bg-base)' }}
      >
        {(stageOpen && !stageFull) || (!stageOpen && !rightCollapsed && !filesChatPreview) ? (
          <PanelResizeEdge
            side="right"
            dragging={rightDragging}
            onMouseDown={startRightDrag}
          />
        ) : null}
        {stageOpen ? (
          <div
            data-pi-slot="browser-stage"
            className="shell-track-inner flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/60"
          >
            {browserStage}
          </div>
        ) : rightCollapsed && !filesChatPreview ? (
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
