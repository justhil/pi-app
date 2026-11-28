import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds))
  if (clamped >= 60) {
    const mins = Math.floor(clamped / 60)
    const secs = clamped % 60
    return `${mins}:${String(secs).padStart(2, '0')}`
  }
  return `${clamped}s`
}

/**
 * Quiet neutral tabular countdown pill matching pi-app status chrome.
 * Shifts to warm amber only during the final 15 seconds.
 */
export function QuestionnaireCountdownBadge({
  deadlineAt,
  timeoutMs,
  compact = false,
}: {
  deadlineAt?: number
  timeoutMs?: number
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadlineAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => window.clearInterval(timer)
  }, [deadlineAt])

  if (!deadlineAt) return null

  const remainingMs = Math.max(0, deadlineAt - now)
  const remainingSec = Math.ceil(remainingMs / 1000)
  const urgent = remainingSec <= 15
  const totalMs = timeoutMs && timeoutMs > 0 ? timeoutMs : undefined
  const progressRatio = totalMs ? Math.max(0, Math.min(1, remainingMs / totalMs)) : undefined

  return (
    <span
      data-testid="questionnaire-countdown-badge"
      data-urgent={urgent ? 'true' : undefined}
      title={t('extension:qAutopilotCountdownHint', {
        time: formatRemaining(remainingSec),
      })}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-md border font-mono tabular-nums transition-colors',
        compact ? 'h-5 px-1.5 text-[10.5px] leading-none' : 'h-5.5 px-2 py-0.5 text-[11px] leading-4',
        urgent
          ? 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border/65 bg-[var(--bg-2)]/65 text-foreground-secondary',
      )}
    >
      {progressRatio !== undefined && (
        <span
          aria-hidden
          style={{ transform: `scaleX(${progressRatio.toFixed(3)})` }}
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-full origin-left transition-transform duration-500 ease-linear',
            urgent ? 'bg-amber-500/15' : 'bg-foreground/[0.06]',
          )}
        />
      )}
      <Clock className="relative h-2.5 w-2.5 shrink-0 opacity-75" />
      <span className="relative">
        {compact
          ? formatRemaining(remainingSec)
          : t('extension:qAutopilotCountdown', { time: formatRemaining(remainingSec) })}
      </span>
    </span>
  )
}
