import { useTranslation } from 'react-i18next'
import { Sparkles } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * Shown above the input while auto-compaction runs for the *current* session.
 * Compaction state is keyed by session file, so a background session's
 * compaction never lights the banner of the session being viewed.
 * The composer stays enabled during compaction — messages are queued by the
 * agent and executed once the summary is written — so this tells the user they
 * can keep sending instead of waiting for the compaction to finish.
 */
export function ComposerCompactionBanner() {
  const { t } = useTranslation()
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const compactingSessions = useUIStore((s) => s.compactingSessions)
  const key = historySessionFile
    ? normalizeSessionFileKey(historySessionFile) || historySessionFile
    : ''
  if (!key || compactingSessions[key] !== true) return null

  return (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-md border border-sky-500/25 bg-sky-500/8 px-2.5 py-1.5 text-[11px] leading-snug text-sky-800 dark:text-sky-200/90"
      aria-live="polite"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1">{t('composer:compactionActiveHint')}</span>
    </div>
  )
}
