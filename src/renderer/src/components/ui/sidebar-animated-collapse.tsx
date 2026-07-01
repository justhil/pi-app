import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

/** 侧栏折叠：用精确 height 动画，避免 max-height 过大导致视觉上瞬间展开。 */
export function SidebarAnimatedCollapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const [height, setHeight] = useState(open ? 'auto' : '0px')
  const [opacity, setOpacity] = useState(open ? 1 : 0)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return

    let raf = 0
    const measured = `${inner.scrollHeight}px`

    if (!initializedRef.current) {
      initializedRef.current = true
      setHeight(open ? 'auto' : '0px')
      setOpacity(open ? 1 : 0)
      return
    }

    if (open) {
      setHeight('0px')
      setOpacity(0)
      raf = requestAnimationFrame(() => {
        setHeight(measured)
        setOpacity(1)
      })
    } else {
      setHeight(measured)
      setOpacity(1)
      raf = requestAnimationFrame(() => {
        setHeight('0px')
        setOpacity(0)
      })
    }

    return () => cancelAnimationFrame(raf)
  }, [open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !open || height === 'auto') return
    const ro = new ResizeObserver(() => {
      setHeight(`${inner.scrollHeight}px`)
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [open, height, children])

  return (
    <div
      ref={outerRef}
      className={cn('sidebar-collapse', open && 'sidebar-collapse-open', className)}
      data-open={open ? 'true' : 'false'}
      style={{ height, opacity }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'height' && open) setHeight('auto')
      }}
    >
      <div ref={innerRef} className="sidebar-collapse-inner">
        {children}
      </div>
    </div>
  )
}
