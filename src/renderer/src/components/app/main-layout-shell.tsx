import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'
import { RightPanelCollapsedRail } from '@renderer/components/app/right-panel-collapsed-rail'

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
}: {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}) {
  const leftCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const leftWidth = useUIStore((s) => s.sidebarWidth)
  const rightCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const rightWidth = useUIStore((s) => s.rightPanelWidth)
  const activePanel = useUIStore((s) => s.activePanel)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const filesChatPreview = activePanel === 'files' && filesPreviewChatExpand && !rightCollapsed

  const [leftDragging, setLeftDragging] = useState(false)
  const [rightDragging, setRightDragging] = useState(false)
  const leftDragRef = useRef(false)
  const rightDragRef = useRef(false)
  const setLeftWidth = useUIStore((s) => s.setSidebarWidth)
  const setRightWidth = useUIStore((s) => s.setRightPanelWidth)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (leftDragRef.current) setLeftWidth(e.clientX)
      if (rightDragRef.current) {
        const leftColW = leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : leftWidth
        const maxRight = Math.max(MIN_RIGHT_PANEL_PX, window.innerWidth - leftColW - MIN_CENTER_GAP)
        setRightWidth(Math.min(window.innerWidth - e.clientX, maxRight))
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
  }, [setLeftWidth, setRightWidth, leftCollapsed, leftWidth])

  // Adapt persisted panel widths when the window is resized: the columns are fixed px from the
  // store, so without this they either overflow the window (center collapses to 0) on smaller
  // windows or stay disproportionately small on larger ones.
  // 注意：窗口缩小只是“临时生效的展示值”，不得写回持久化首选宽度——否则缩小一次就永久
  // 丢失用户设置（放大后无法恢复）。resize 只触发重渲染，实际 clamp 在渲染时实时计算。
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  )
  useEffect(() => {
    const onWindowResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onWindowResize)
    // 挂载时也触发一次，让超大的持久化宽度适配当前窗口
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  const maxLeftFor = (w: number): number => Math.max(MIN_SIDEBAR_PX, Math.round(w * 0.4))
  const effectiveLeft = leftCollapsed ? 0 : Math.min(leftWidth, maxLeftFor(windowWidth))
  const leftColW = leftCollapsed ? RIGHT_COLLAPSED_RAIL_PX : effectiveLeft
  const maxRight = Math.max(MIN_RIGHT_PANEL_PX, windowWidth - leftColW - MIN_CENTER_GAP)
  const effectiveRight = rightCollapsed ? RIGHT_COLLAPSED_RAIL_PX : Math.min(rightWidth, maxRight)

  const leftCol = leftCollapsed ? '0px' : `${effectiveLeft}px`
  const rightCol = rightCollapsed ? `${RIGHT_COLLAPSED_RAIL_PX}px` : `${effectiveRight}px`
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
      className={cn(
        'shell-three-col min-h-0 flex-1',
        filesChatPreview && 'shell-files-chat-preview',
        leftDragging && 'shell-left-dragging',
        rightDragging && 'shell-right-dragging',
        rightCollapsed && !filesChatPreview && 'shell-right-rail-only',
      )}
      style={{ gridTemplateColumns: gridCols }}
    >
      <div
        className={cn(
          'shell-track-left relative flex min-w-0 flex-row items-stretch overflow-hidden',
          leftCollapsed && 'shell-track-collapsed',
        )}
        style={{ background: 'var(--surface-sidebar)' }}
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
          <PanelResizeEdge
            side="right"
            dragging={rightDragging}
            onMouseDown={startRightDrag}
          />
        ) : null}
        {rightCollapsed && !filesChatPreview ? (
          <RightPanelCollapsedRail />
        ) : (
          <div className="shell-track-inner flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {right}
          </div>
        )}
      </div>
    </div>
  )
}
