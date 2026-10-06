import { registerHandler } from '../registry'
import { resolveActiveAgentDir } from '../../agent-dir'
import { sessionPreviewProcess } from '../../session-preview-process'

const DAY = 86_400_000

export function registerUsageHandlers(): void {
  /** Settings → Usage: totals for the last `days` local days (today included; 0 = all time), or an explicit range. */
  registerHandler('ipc:usage.summary', async (req) => {
    const r = (req ?? {}) as { days?: number; from?: number; to?: number }
    const offsetMin = -new Date().getTimezoneOffset()
    const now = Date.now()
    // Local midnight after today.
    const end = Math.floor((now + offsetMin * 60_000) / DAY) * DAY + DAY - offsetMin * 60_000
    // days = 0: all time (the scan starts at the first recorded reply).
    const all = r.days === 0
    const days = Math.min(Math.max(1, Math.round(Number(r.days) || 7)), 366)
    const from = Number.isFinite(r.from) ? Number(r.from) : all ? 0 : end - days * DAY
    const to = Number.isFinite(r.to) ? Number(r.to) : end
    return sessionPreviewProcess.usageSummary({ agentDir: resolveActiveAgentDir(), from, to, offsetMin })
  })
}
