import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Container width in px. Measured synchronously on mount (no first-frame jump from the fallback),
 * then followed by one ResizeObserver whose updates are coalesced to animation frames.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(fallback = 560): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const initial = Math.round(element.getBoundingClientRect().width)
    if (initial > 0) setWidth(initial)
    if (typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      if (!next) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth((previous) => (previous === next ? previous : next)))
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
  return [ref, width]
}
