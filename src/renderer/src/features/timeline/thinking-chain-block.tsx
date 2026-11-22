import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from '@renderer/components/icons'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { anchorViewportBeforeCollapse } from './collapse-scroll-anchor'

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
  duration,
  labelSeed,
  placeholder = false,
  liveLabel,
  showElapsed = false,
  leadingGlyph,
}: {
  text: string
  streaming?: boolean
  nested?: boolean
  startedAt?: number
  duration?: number
  labelSeed?: string
  placeholder?: boolean
  /** Overrides the rotating live label (e.g. reply placeholder stages). */
  liveLabel?: string
  /** Append the running wait time once it passes 2s, so a long wait still reads as progress. */
  showElapsed?: boolean
  /** Replaces the empty 12px leading slot of a placeholder (e.g. the pixel wave). */
  leadingGlyph?: ReactNode
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [userOpen, setUserOpen] = useState(false)
  const open = userOpen && !placeholder
  const startedAtRef = useRef<number | null>(startedAt ?? null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const body = text.trim()
  const lineCount = body ? body.split(/\r?\n/).length : 0
  const isLive = !!streaming || placeholder
  const livePreview = useMemo(() => {
    if (!isLive || placeholder || !body) return ''
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.replace(/^[#*>-]+\s*/, '').replace(/\*\*/g, '').trim())
      .filter(Boolean)
    const tail = lines.at(-1) ?? ''
    return tail.length > 72 ? `${tail.slice(0, 72)}…` : tail
  }, [body, isLive, placeholder])

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
      if (duration != null) {
        setElapsedMs(duration)
      } else {
        setElapsedMs(0)
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
  }, [isLive, duration])

  const liveKey = useMemo(
    () => pickStableLiveKey(labelSeed || body.slice(0, 24) || 'think'),
    [labelSeed, body],
  )

  const label = useMemo(() => {
    if (isLive) {
      const base = liveLabel ?? t(liveKey)
      return showElapsed && elapsedMs >= 2000
        ? t('timeline:pendingStage.elapsed', { label: base, seconds: Math.floor(elapsedMs / 1000) })
        : base
    }
    if (elapsedMs > 0) {
      const d = formatThoughtDuration(elapsedMs)
      return t(d.labelKey, { seconds: d.seconds })
    }
    return t('timeline:thoughtDone')
  }, [isLive, liveKey, liveLabel, showElapsed, elapsedMs, t])

  if (!placeholder && !body) return null

  const handleCollapse = () => {
    anchorViewportBeforeCollapse(rootRef.current)
    setUserOpen(false)
  }

  return (
    <div ref={rootRef} data-pi-slot="timeline-thinking" className="mb-0">
      <button
        type="button"
        onClick={() => {
          if (placeholder || !body) return
          if (open) handleCollapse()
          else setUserOpen(true)
        }}
        className={cn(
          'timeline-activity-row',
          (placeholder || !body) && 'cursor-default hover:bg-transparent',
        )}
      >
        {placeholder && leadingGlyph ? (
          leadingGlyph
        ) : placeholder || !body ? (
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
            'timeline-activity-label shrink-0',
            isLive ? 'thinking-shimmer-ltr' : 'thinking-chain-label',
          )}
        >
          {label}
        </span>
        {!open && livePreview ? (
          <span className="min-w-0 truncate pl-1.5 text-[11.5px] timeline-text-placeholder">
            {livePreview}
          </span>
        ) : null}
      </button>
      {!placeholder && body && open ? (
        <div className={cn(nested ? 'ml-3' : 'ml-3.5')}>
          <div
            data-independent-scroll
            className="thinking-chain-body max-h-96 overflow-y-auto overscroll-contain border-l border-border/35 pl-2.5 text-[13px] leading-[1.62] whitespace-pre-wrap break-words"
          >
            {body}
          </div>
          {lineCount >= 8 && (
            <button
              type="button"
              onClick={handleCollapse}
              className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary/70 transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <ChevronDown className="h-3 w-3 rotate-180" />
              <span>{t('timeline:collapse')}</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
