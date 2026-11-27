import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

const HEIGHT_TRANSITION_FALLBACK_MS = 240

/**
 * Smooth height transition container inspired by T3 Code's AnimatedHeight.
 * Clips only during active height interpolation and restores overflow: visible once settled,
 * so popovers, shadows, and focus rings inside are never cut off.
 */
export function AnimatedHeight({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ height: number | null; clipping: boolean }>({
    height: null,
    clipping: false,
  })

  useEffect(() => {
    if (!state.clipping) return
    const timer = window.setTimeout(() => {
      setState((cur) => (cur.clipping ? { ...cur, clipping: false } : cur))
    }, HEIGHT_TRANSITION_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [state.height, state.clipping])

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    let raf1: number | null = null
    let raf2: number | null = null

    const measure = () => {
      const next = Math.ceil(el.scrollHeight || el.getBoundingClientRect().height)
      setState((cur) => {
        if (cur.height === next) return cur
        return { height: next, clipping: cur.height !== null }
      })
    }

    const cancelFrames = () => {
      if (raf1 !== null) {
        window.cancelAnimationFrame(raf1)
        raf1 = null
      }
      if (raf2 !== null) {
        window.cancelAnimationFrame(raf2)
        raf2 = null
      }
    }

    const schedule = () => {
      cancelFrames()
      measure()
      raf1 = window.requestAnimationFrame(() => {
        raf1 = null
        measure()
        raf2 = window.requestAnimationFrame(() => {
          raf2 = null
          measure()
        })
      })
    }

    schedule()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      cancelFrames()
    }
  }, [])

  return (
    <div
      data-slot="animated-height"
      className={cn(
        'transition-[height] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none [overflow-clip-margin:2px]',
        className,
      )}
      style={
        state.height === null
          ? undefined
          : {
              height: state.height,
              overflow: state.clipping ? 'clip' : 'visible',
            }
      }
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget || e.propertyName !== 'height') return
        setState((cur) => (cur.clipping ? { ...cur, clipping: false } : cur))
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  )
}
