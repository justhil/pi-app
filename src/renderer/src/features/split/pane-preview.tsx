import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { getSessionView } from '@renderer/lib/session-shell'
import { fetchSessionHistoryTail } from '@renderer/lib/session-history'
import { cn } from '@renderer/lib/utils'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const MAX_ROWS = 40

type Row =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tools'; id: string; count: number; failed: boolean; live: boolean }

/** Markdown to plain reading text for the preview (no syntax characters). */
export function plainText(md: string): string {
  return md
    .replace(/^```.*$/gm, '')
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}.*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) => row.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Compact rows for a read-only pane: messages as text, tool runs folded into one line. */
export function previewRows(items: readonly TimelineItem[]): Row[] {
  const rows: Row[] = []
  for (const it of items) {
    if (it.type === 'user-message' || it.type === 'assistant-message') {
      const text = plainText(String(it.text ?? ''))
      if (text) rows.push(it.type === 'user-message' ? { kind: 'user', id: it.id, text } : { kind: 'assistant', id: it.id, text })
    } else if (it.type === 'tool-call') {
      const last = rows.at(-1)
      const live = it.toolPhase === 'start' || it.toolPhase === 'update'
      if (last?.kind === 'tools') {
        last.count++
        last.failed ||= !!it.isError
        last.live ||= live
      } else rows.push({ kind: 'tools', id: it.id, count: 1, failed: !!it.isError, live })
    }
  }
  return rows.slice(-MAX_ROWS)
}

export interface PaneDigest {
  lastUser: string
  lastReply: string
  /** Tool calls since the last user message, and whether one is running. */
  tools: number
  toolLive: boolean
  turns: number
}

/** What a small pane card shows: the latest question, the reply to it so far, tool activity. */
export function paneDigest(items: readonly TimelineItem[] | null): PaneDigest {
  const d: PaneDigest = { lastUser: '', lastReply: '', tools: 0, toolLive: false, turns: 0 }
  for (const it of items ?? []) {
    if (it.type === 'user-message') {
      d.turns++
      d.lastUser = plainText(String(it.text ?? ''))
      d.lastReply = ''
      d.tools = 0
      d.toolLive = false
    } else if (it.type === 'assistant-message') {
      const text = plainText(String(it.text ?? ''))
      if (text) d.lastReply = text
    } else if (it.type === 'tool-call') {
      d.tools++
      d.toolLive = it.toolPhase === 'start' || it.toolPhase === 'update'
    }
  }
  return d
}

/** In-memory sources: a running background session streams into the live cache. */
function readLive(sessionFile: string): TimelineItem[] | null {
  const live = getLiveSessionTimeline(sessionFile)?.timelineItems
  return live?.length ? live : null
}

/**
 * Which source to show: the one that reaches the latest turn (most user messages), then the
 * one whose latest turn already has its answer, then the longest. A background run's live
 * stream is ahead of the disk while it answers; a stale live cache loses to a newer disk tail.
 */
export function pickPreviewSource(live: TimelineItem[] | null, disk: TimelineItem[] | null, view: TimelineItem[] | null): TimelineItem[] | null {
  const candidates = [live, disk, view].filter((c): c is TimelineItem[] => !!c && c.length > 0)
  if (!candidates.length) return disk ?? view ?? live
  const turns = (c: TimelineItem[]) => c.reduce((n, it) => n + (it.type === 'user-message' ? 1 : 0), 0)
  return candidates.sort((a, b) => turns(b) - turns(a) || Number(hasSettledReply(b)) - Number(hasSettledReply(a)) || b.length - a.length)[0]
}

/** Answer text is complete only once a non-empty assistant message follows the last user message. */
function hasSettledReply(items: readonly TimelineItem[]): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'user-message') return false
    if (items[i].type === 'assistant-message' && String(items[i].text ?? '').trim()) return true
  }
  return false
}

/**
 * The latest part of a session for an inactive pane, read from the live cache (background runs
 * keep streaming into it), the session view cache, or the disk tail. Polled only while the window
 * is visible; the full timeline mounts when the pane is activated.
 */
export function usePaneTimeline(sessionFile: string | null): TimelineItem[] | null {
  const [items, setItems] = useState<TimelineItem[] | null>(() => (sessionFile ? readLive(sessionFile) ?? getSessionView(sessionFile)?.items ?? null : null))
  useEffect(() => {
    if (!sessionFile) {
      setItems(null)
      return
    }
    let disk: TimelineItem[] | null = null
    let sig = ''
    let cancelled = false
    let lastDiskAt = 0
    const show = (next: TimelineItem[] | null) => {
      const last = next?.at(-1)
      const nextSig = `${next?.length ?? -1}:${last?.id ?? ''}:${String(last?.text ?? '').length}:${last?.toolPhase ?? ''}`
      if (nextSig === sig) return
      sig = nextSig
      setItems(next)
    }
    // Disk tail is the base truth for a session that is not streaming right now.
    const loadDisk = async () => {
      lastDiskAt = Date.now()
      try {
        const res = await fetchSessionHistoryTail(sessionFile, 60, { bypassCache: true })
        if (cancelled) return
        disk = (res.items || []) as TimelineItem[]
      } catch {
        // keep whatever we had
      }
    }
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      // Keep the disk tail fresh: a first read can land before the reply is saved.
      if (Date.now() - lastDiskAt > 4000) void loadDisk().then(tick)
      const live = readLive(sessionFile)
      const view = getSessionView(sessionFile)?.items
      show(pickPreviewSource(live, disk, view ?? null))
    }
    void loadDisk().then(tick)
    tick()
    const timer = window.setInterval(tick, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionFile])

  return items
}

/** What an inactive pane shows when it has room: the latest messages as plain text. */
function PanePreviewImpl({ sessionFile, running = false }: { sessionFile: string | null; running?: boolean }) {
  const { t } = useTranslation()
  const items = usePaneTimeline(sessionFile)

  if (!sessionFile) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-foreground-tertiary">{t('common:split.emptyPane')}</div>
  }
  const rows = items ? previewRows(items) : []
  if (!rows.length) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-foreground-tertiary">{t('common:split.clickToLoad')}</div>
  }
  return (
    // column-reverse keeps the newest content in view without scroll bookkeeping.
    <div className="flex h-full flex-col-reverse overflow-y-auto px-5 py-4">
      <div className="mx-auto w-full max-w-[720px] space-y-3">
        {rows.map((row) =>
          row.kind === 'user' ? (
            <div key={row.id} className="flex justify-end">
              <div className="line-clamp-6 max-w-[85%] whitespace-pre-wrap rounded-xl bg-[var(--bg-hover)] px-3 py-1.5 text-[12.5px] leading-relaxed text-foreground">{row.text}</div>
            </div>
          ) : row.kind === 'assistant' ? (
            <div key={row.id} className="line-clamp-[12] whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/85">{row.text}</div>
          ) : (
            <div key={row.id} className={cn('text-[11.5px]', row.failed ? 'text-destructive/80' : 'text-foreground-tertiary')}>
              {row.live ? <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary align-middle" /> : null}
              {t('common:split.toolRun', { count: row.count })}
            </div>
          ),
        )}
        {running && rows.at(-1)?.kind !== 'assistant' ? (
          <div className="text-[11.5px] text-foreground-tertiary">{t('common:split.replying')}</div>
        ) : null}
      </div>
    </div>
  )
}

export const PanePreview = memo(PanePreviewImpl)
