import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

const LIVE_LABEL_KEYS = [
  'timeline:thinkingLive.thinking',
  'timeline:thinkingLive.briefly',
  'timeline:thinkingLive.working',
  'timeline:thinkingLive.reasoning',
] as const

function pickStableLiveKey(seed: string): (typeof LIVE_LABEL_KEYS)[number] {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return LIVE_LABEL_KEYS[hash % LIVE_LABEL_KEYS.length]
}

function formatThoughtDuration(ms: number): { seconds: number; labelKey: string } {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return { seconds, labelKey: 'timeline:thoughtForSeconds' }
}

/**
 * Thinking: quiet 12px activity line.
 * Live: shimmer only (no stacked pulse).
 * Done: "Thought for Xs".
 */
export function ThinkingChainBlock({
  text,
  streaming,
  nested = false,
  startedAt,
  labelSeed,
  placeholder = false,
}: {
  text: string
  streaming?: boolean
  nested?: boolean
  startedAt?: number
  labelSeed?: string
  placeholder?: boolean
}) {
  const { t } = useTranslation()
  const [userOpen, setUserOpen] = useState(false)
  const open = userOpen && !placeholder
  const startedAtRef = useRef<number | null>(startedAt ?? null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const body = text.trim()
  const isLive = !!streaming || placeholder

  useEffect(() => {
    if (startedAt != null && startedAtRef.current == null) {
      startedAtRef.current = startedAt
    }
    if (isLive && startedAtRef.current == null) {
      startedAtRef.current = Date.now()
    }
  }, [startedAt, isLive])

  useEffect(() => {
    if (!isLive) {
      if (startedAtRef.current != null) {
        setElapsedMs(Math.max(0, Date.now() - startedAtRef.current))
      }
      return
    }
    const tick = () => {
      const start = startedAtRef.current ?? Date.now()
      setElapsedMs(Math.max(0, Date.now() - start))
    }
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [isLive])

  const liveKey = useMemo(
    () => pickStableLiveKey(labelSeed || body.slice(0, 24) || 'think'),
    [labelSeed, body],
  )

  const label = useMemo(() => {
    if (isLive) return t(liveKey)
    const duration = formatThoughtDuration(elapsedMs || 1000)
    return t(duration.labelKey, { seconds: duration.seconds })
  }, [isLive, liveKey, elapsedMs, t])

  if (!placeholder && !body) return null

  return (
    <div className="mb-0">
      <button
        type="button"
        onClick={() => {
          if (placeholder || !body) return
          setUserOpen((prev) => !prev)
        }}
        className={cn(
          'timeline-activity-row',
          (placeholder || !body) && 'cursor-default hover:bg-transparent',
        )}
      >
        {placeholder || !body ? (
          <span className="w-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight
            className={cn(
              'chevron-expand h-3 w-3 timeline-text-placeholder',
              open && 'rotate-90',
            )}
          />
        )}
        <span
          className={cn(
            'timeline-activity-label',
            isLive ? 'thinking-shimmer-ltr' : 'timeline-text-quiet',
          )}
        >
          {label}
        </span>
      </button>
      {!placeholder && body && open ? (
        <div
          className={cn(
            'max-h-40 overflow-auto border-l border-border/12 pl-2 text-[11px] leading-[1.5] timeline-text-placeholder whitespace-pre-wrap break-words font-mono',
            nested ? 'ml-3' : 'ml-3.5',
          )}
        >
          {body}
        </div>
      ) : null}
    </div>
  )
}
