// Streaming primitives for timeline (Cursor-inspired soft caret).
// Status dots / "running" indicators are intentionally not used.
import { useState, useEffect } from 'react'
import { cn } from '@renderer/lib/utils'

/** @deprecated Prefer silence over status dots; kept as no-op for any stray imports. */
export function ThinkingIndicator(_props: { label?: string }) {
  return null
}

// Streaming caret appended to in-progress assistant text
export function StreamingCaret() {
  return (
    <span
      className={cn(
        'stream-caret ml-[2px] inline-block h-[1.05em] w-[1.5px] translate-y-[2px] rounded-[1px]',
        'bg-foreground/50 align-baseline',
      )}
      aria-hidden
    />
  )
}

// Show a subtle stall hint after the streaming delta has been silent for >stallMs.
// Pass a `deltaKey` that changes on each token (e.g. text length) so the timer resets while streaming is active.
export function useStalledHint(streaming: boolean, deltaKey: unknown, stallMs = 800): boolean {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!streaming) {
      setStalled(false)
      return
    }
    setStalled(false)
    const timer = setTimeout(() => setStalled(true), stallMs)
    return () => clearTimeout(timer)
  }, [streaming, deltaKey, stallMs])
  return stalled
}
