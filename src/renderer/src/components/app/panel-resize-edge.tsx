import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { cn } from '@renderer/lib/utils'

/** 鼠标在分界条上停留后再高亮，避免划过时毫秒级闪一下 */
const DWELL_MS = 200

export function PanelResizeEdge({
  dragging,
  onMouseDown,
}: {
  dragging: boolean
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void
}) {
  const [armed, setArmed] = useState(false)
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDwell = () => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current)
      dwellRef.current = null
    }
  }

  useEffect(() => () => clearDwell(), [])

  useEffect(() => {
    if (!dragging) setArmed(false)
  }, [dragging])

  const onEnter = () => {
    clearDwell()
    dwellRef.current = setTimeout(() => setArmed(true), DWELL_MS)
  }

  const onLeave = () => {
    clearDwell()
    if (!dragging) setArmed(false)
  }

  const onDown = (e: MouseEvent<HTMLDivElement>) => {
    clearDwell()
    setArmed(true)
    onMouseDown(e)
  }

  const show = dragging || armed

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onDown}
      className={cn(
        'panel-resize-edge shrink-0 cursor-col-resize',
        show && 'panel-resize-edge-armed',
        dragging && 'panel-resize-edge-active',
      )}
    />
  )
}