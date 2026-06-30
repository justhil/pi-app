import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * 侧栏树折叠：内联 height + globals `.sidebar-collapse` 过渡。
 * 首次展开也必须走 0→measured，不能用 initializedRef 直接设为 auto（否则无动画）。
 */
export function SidebarAnimatedCollapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState('0px')
  const [opacity, setOpacity] = useState(0)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return

    let raf1 = 0
    let raf2 = 0
    const measure = () => `${inner.scrollHeight}px`

    if (open) {
      setHeight('0px')
      setOpacity(0)
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setHeight(measure())
          setOpacity(1)
        })
      })
    } else {
      setHeight(measure())
      setOpacity(1)
      raf1 = requestAnimationFrame(() => {
        setHeight('0px')
        setOpacity(0)
      })
    }

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !open) return
    const ro = new ResizeObserver(() => {
      if (innerRef.current) setHeight(`${innerRef.current.scrollHeight}px`)
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [open, children])

  return (
    <div
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