import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChatTimelineProgressRail } from '@renderer/features/timeline/chat-timeline-progress-rail'
import { PanelResizeEdge } from '@renderer/components/app/panel-resize-edge'

/**
 * 三栏 Grid：侧栏用 0fr ↔ 固定宽 过渡，中间列 1fr 由浏览器插值，避免 width 动画每帧重排 Timeline。
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

  /* 0px↔px 可插值；0fr 在多数引擎里不做过渡会瞬变 */
  const leftCol = leftCollapsed ? '0px' : `${leftWidth}px`
  const rightCol = rightCollapsed ? '0px' : `${rightWidth}px`
  const gridCols = `${leftCol} minmax(0, 1fr) ${rightCol}`

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
        leftDragging && 'shell-left-dragging',
        rightDragging && 'shell-right-dragging',
      )}
      style={{ gridTemplateColumns: gridCols }}
    >
      <div
        className={cn(
          'shell-track-left relative flex min-w-0 flex-row items-stretch overflow-hidden border-r border-border/60',
          leftCollapsed && 'shell-track-collapsed border-r-0',
        )}
        style={{ background: 'var(--bg-1)' }}
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
          <PanelResizeEdge dragging={leftDragging} onMouseDown={startLeftDrag} />
        )}
      </div>

      <div className="shell-track-center relative min-w-0 overflow-hidden">{center}</div>

      <div
        className={cn(
          'shell-track-right relative flex min-w-0 flex-row items-stretch overflow-hidden border-l border-border/60',
          rightCollapsed && 'shell-track-collapsed border-l-0',
        )}
        style={{ background: 'var(--bg-1)' }}
        aria-hidden={rightCollapsed}
      >
        {!rightCollapsed && (
          <>
            <ChatTimelineProgressRail placement="panel-edge" />
            <PanelResizeEdge dragging={rightDragging} onMouseDown={startRightDrag} />
          </>
        )}
        <div
          className={cn(
            'shell-track-inner min-h-0 min-w-0 flex flex-1 flex-col',
            rightCollapsed && 'pointer-events-none',
          )}
        >
          {right}
        </div>
      </div>
    </div>
  )
}