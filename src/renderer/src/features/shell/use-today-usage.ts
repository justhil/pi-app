import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'

/** Warm while a turn runs; the scan itself is mtime-cached, so a poll re-reads only changed files. */
const REFRESH_MS = 15_000

/**
 * Today's usage (local midnight → now) for the status bar. Same source as Settings → Usage, so the
 * two cannot disagree. Polls while visible and re-reads on demand when a turn ends.
 */
export function useTodayUsage(): { usage: UsageSummary | null; failed: boolean; refresh: () => void } {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(() => {
    void ipcClient.invoke('usage.summary', { days: 1 })
      .then((summary: UsageSummary) => {
        if (!mounted.current) return
        const valid = typeof summary?.total?.cost === 'number'
        setUsage(valid ? summary : null)
        setFailed(!valid)
      })
      .catch(() => { if (mounted.current) setFailed(true) })
  }, [])

  useVisibleInterval(refresh, REFRESH_MS)
  return { usage, failed, refresh }
}
