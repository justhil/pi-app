import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * 侧栏树折叠：内联 height + globals `.sidebar-collapse` 过渡。
 * 首次展开也必须走 0→measured，不能用 initializedRef 直接设为 auto（否则无动画）。
 * 折叠后的内容在收起动画结束时卸载：折叠的项目 / 分组不再随流式状态重渲染。
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
  const [height, setHeight] = useState(open ? 'auto' : '0px')
  const [opacity, setOpacity] = useState(open ? 1 : 0)
  const [mounted, setMounted] = useState(open)
  const firstRun = useRef(true)

  useLayoutEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    // Initially open: render at auto height without replaying the expand animation.
    if (firstRun.current) {
      firstRun.current = false
      if (open) return
    }
    if (!inner) return

    let raf1 = 0
    let raf2 = 0
    let unmountTimer = 0
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
      // transitionend never fires with reduced motion / zero-duration transitions.
      unmountTimer = window.setTimeout(() => setMounted(false), 420)
    }

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(unmountTimer)
    }
  }, [open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !open) return
    const ro = new ResizeObserver(() => {
      if (innerRef.current && height !== 'auto') setHeight(`${innerRef.current.scrollHeight}px`)
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [open, height])

  return (
    <div
      className={cn('sidebar-collapse', open && 'sidebar-collapse-open', className)}
      data-open={open ? 'true' : 'false'}
      style={{ height, opacity }}
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget || e.propertyName !== 'height') return
        if (open) setHeight('auto')
        else setMounted(false)
      }}
    >
      <div ref={innerRef} className="sidebar-collapse-inner">
        {mounted ? children : null}
      </div>
    </div>
  )
}
