import { useTranslation } from 'react-i18next'
import { ListOrdered } from 'lucide-react'
import { useUIStore } from '@renderer/stores/ui-store'

function truncateLine(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}…`
}

/** Pending steer / follow-up queue shown above input */
export function ComposerPendingQueue() {
  const { t } = useTranslation()
  const steering = useUIStore((s) => s.pendingSteering)
  const followUp = useUIStore((s) => s.pendingFollowUp)
  if (steering.length === 0 && followUp.length === 0) return null

  const total = steering.length + followUp.length

  return (
    <div
      className="composer-pending-queue mb-1.5 rounded-md border border-border/35 bg-[var(--bg-2)]/40 px-2 py-1.5 text-[12px] leading-snug text-foreground-secondary/70"
      aria-live="polite"
      aria-label={t('composer:queueAria', { count: total })}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground-secondary/60">
        <ListOrdered className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span>{t('composer:queueTitle', { count: total })}</span>
      </div>
      <ul className="space-y-0.5">
        {steering.map((msg, index) => (
          <li key={`steer-${index}`} className="flex gap-1.5 truncate font-mono text-[11px]">
            <span className="shrink-0 text-[color:var(--status-live)]/80">{t('composer:steering')}</span>
            <span className="min-w-0 truncate text-foreground-secondary/75">{truncateLine(msg)}</span>
          </li>
        ))}
        {followUp.map((msg, index) => (
          <li key={`fu-${index}`} className="flex gap-1.5 truncate font-mono text-[11px]">
            <span className="shrink-0 text-foreground-secondary/50">{t('composer:queued')}</span>
            <span className="min-w-0 truncate text-foreground-secondary/75">{truncateLine(msg)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 border-t border-border/25 pt-1 text-[10px] text-foreground-secondary/45">
        {t('composer:queueHint')}
      </div>
    </div>
  )
}
