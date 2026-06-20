// Streaming/thinking primitives for timeline (ui-timeline-polish).
// No tool icon or plugin rendering here — those live in tool-icon.tsx / tool-card-templates.tsx.
import { useState, useEffect } from 'react'

// Thinking/streaming indicator: shimmer text instead of 3 bounce dots (桌面 Agent UI-inspired)
export function ThinkingIndicator({ label = '思考中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2.5">
      <span className="text-[13px] text-foreground-secondary animate-thinking-pulse">
        {label}…
      </span>
    </div>
  )
}

// Streaming caret appended to in-progress assistant text
export function StreamingCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] rounded-full"
      style={{ background: 'var(--brand)', animation: 'caret-blink 1.1s ease-in-out infinite' }}
      aria-hidden
    />
  )
}

// Show a subtle "思考中" hint after the streaming delta has been silent for >stallMs.
// Pass a `deltaKey` that changes on each token (e.g. text length) so the timer resets while streaming is active.
export function useStalledHint(streaming: boolean, deltaKey: unknown, stallMs = 800): boolean {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!streaming) { setStalled(false); return }
    setStalled(false)
    const t = setTimeout(() => setStalled(true), stallMs)
    return () => clearTimeout(t)
  }, [streaming, deltaKey, stallMs])
  return stalled
}
