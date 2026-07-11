import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'
import { RightPanelCollapsedRail } from '@renderer/components/app/right-panel-collapsed-rail'

/** Collapsed right rail width — keep in sync with RightPanelCollapsedRail (w-10 = 40px) */
const RIGHT_COLLAPSED_RAIL_PX = 40

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
      if (rightDragRef.current) setRightWidth(window.innerWidth - e.clientX)
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
  }, [setLeftWidth, setRightWidth])

  const leftCol = leftCollapsed ? '0px' : `${leftWidth}px`
  const rightCol = rightCollapsed ? `${RIGHT_COLLAPSED_RAIL_PX}px` : `${rightWidth}px`
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
          'shell-track-center min-w-0 overflow-hidden',
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
