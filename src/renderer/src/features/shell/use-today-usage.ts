import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'

/** Warm while a turn runs; the scan itself is mtime-cached, so a poll re-reads only changed files. */
const REFRESH_MS = 15_000
/** Today plus the six days before it, for the trend strip and "vs yesterday". */
const HISTORY_DAYS = 7

/**
 * Today's usage (local midnight → now) for the status bar, plus the week ending today once the
 * popover asks for it. Same source as Settings → Usage, so the two cannot disagree.
 */
export function useTodayUsage(): {
  usage: UsageSummary | null
  failed: boolean
  history: UsageSummary | null
  historyFailed: boolean
  refresh: () => void
  loadHistory: () => void
} {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [history, setHistory] = useState<UsageSummary | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)
  const mounted = useRef(true)
  /** Set once the popover opened: from then on every poll also refreshes the week. */
  const wantsHistory = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const readHistory = useCallback(() => {
    void ipcClient.invoke('usage.summary', { days: HISTORY_DAYS })
      .then((summary: UsageSummary) => {
        if (!mounted.current) return
        const valid = typeof summary?.total?.cost === 'number' && Array.isArray(summary.byDay)
        setHistory(valid ? summary : null)
        setHistoryFailed(!valid)
      })
      .catch(() => { if (mounted.current) setHistoryFailed(true) })
  }, [])

  const refresh = useCallback(() => {
    if (wantsHistory.current) readHistory()
    void ipcClient.invoke('usage.summary', { days: 1 })
      .then((summary: UsageSummary) => {
        if (!mounted.current) return
        // A reply without the expected shape (older build, aborted) must not crash the status bar.
        const valid = typeof summary?.total?.cost === 'number'
        setUsage(valid ? summary : null)
        setFailed(!valid)
      })
      .catch(() => { if (mounted.current) setFailed(true) })
  }, [readHistory])

  const loadHistory = useCallback(() => {
    wantsHistory.current = true
    if (!history) readHistory()
  }, [history, readHistory])

  useVisibleInterval(refresh, REFRESH_MS)
  return { usage, failed, history, historyFailed, refresh, loadHistory }
}
