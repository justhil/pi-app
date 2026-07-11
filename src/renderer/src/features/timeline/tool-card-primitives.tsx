// Streaming/thinking primitives for timeline (Cursor-inspired: shimmer text + soft caret).
// No tool icon or plugin rendering here — those live in tool-icon.tsx / tool-card-templates.tsx.
import { useState, useEffect } from 'react'
import { cn } from '@renderer/lib/utils'

// Thinking/streaming indicator: shimmer text instead of 3 bounce dots
export function ThinkingIndicator({ label = '思考中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="tool-status-live-dot absolute inset-0" />
      </span>
      <span className="text-[13px] tracking-tight text-foreground-secondary animate-thinking-pulse">
        {label}…
      </span>
    </div>
  )
}

// Streaming caret appended to in-progress assistant text
export function StreamingCaret() {
  return (
    <span
      className={cn(
        'stream-caret ml-[2px] inline-block h-[1.05em] w-[1.5px] translate-y-[2px] rounded-[1px]',
        'bg-foreground/55 align-baseline',
      )}
      aria-hidden
    />
  )
}

// Show a subtle "思考中" hint after the streaming delta has been silent for >stallMs.
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
