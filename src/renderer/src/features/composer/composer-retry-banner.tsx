import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from '@renderer/components/icons'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionRetryInfo } from '@renderer/stores/ui-store-types'

/** Retry state of the session being viewed, if pi is retrying a failed model request. */
export function useViewRetryInfo(): SessionRetryInfo | null {
  return useUIStore((s) => {
    const file = s.historySessionFile
    if (!file) return null
    return s.retryingSessions[normalizeSessionFileKey(file) || file] ?? null
  })
}

/** Short, readable reason for the common transport failures; anything else is shown trimmed. */
export function retryReasonLabel(errorMessage: string, t: ReturnType<typeof useTranslation>['t']): string {
  const message = errorMessage.trim()
  if (/timed? ?out/i.test(message)) return t('composer:retry.reasonTimeout')
  if (/connection error|ECONNRESET|socket hang up/i.test(message)) return t('composer:retry.reasonConnection')
  const status = /^(\d{3})\b/.exec(message)?.[1]
  if (status) return t('composer:retry.reasonStatus', { status })
  if (!message) return t('composer:retry.reasonUnknown')
  return message.length > 60 ? `${message.slice(0, 60)}…` : message
}

/**
 * Shown above the input while pi waits to retry a failed model request (timeout, 5xx…) for the
 * current session. Without it the turn just looks stuck on "waiting for the model".
 */
export function ComposerRetryBanner() {
  const { t } = useTranslation()
  const retry = useViewRetryInfo()
  const [now, setNow] = useState(() => Date.now())
  const retryAt = retry ? retry.startedAt + retry.delayMs : 0

  useEffect(() => {
    if (!retry) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [retry])

  if (!retry) return null
  const seconds = Math.ceil((retryAt - now) / 1000)
  const reason = retryReasonLabel(retry.errorMessage, t)
  const counter = { attempt: retry.attempt, max: retry.maxAttempts }

  return (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200/90"
      role="status"
      aria-live="polite"
      title={retry.errorMessage || undefined}
      data-composer-retry=""
    >
      <RotateCcw className="h-3.5 w-3.5 shrink-0 animate-spin [animation-direction:reverse] [animation-duration:2s]" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {reason} · {seconds > 0 ? t('composer:retry.waiting', { ...counter, seconds }) : t('composer:retry.running', counter)}
      </span>
    </div>
  )
}
