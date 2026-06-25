// Streaming/thinking primitives for timeline (ui-timeline-polish).
// No tool icon or plugin rendering here — those live in tool-icon.tsx / tool-card-templates.tsx.
import { useState, useEffect } from 'react'

// Thinking/streaming indicator: shimmer text instead of 3 bounce dots (参考桌面客户端-inspired)
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
      className="stream-caret ml-0.5 inline-block h-[1em] w-[1.5px] translate-y-[1px] rounded-full bg-foreground/55"
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
