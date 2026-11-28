import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { fetchSessionHistoryOlder, fetchSessionHistoryTail } from '@renderer/lib/session-history'
import { VIEW_REVEAL_CHUNK_LIMIT, isTargetNewerThanStore, missingOlderItems, userSentSince } from './timeline-view-jump'

/**
 * Read-only history load for a view jump whose target is not in the store yet: fetches the
 * chunk around `entryId`, closes any gap up to the loaded tail so the store stays contiguous,
 * and prepends what is missing. Gives up silently when the jump is no longer current (a newer
 * jump, a session switch, the user sent a message) — the caller owns that check.
 */
export async function loadViewRevealChunk({
  sessionFile,
  entryId,
  stillCurrent,
  captured,
  tail,
}: {
  sessionFile: string
  entryId: string
  stillCurrent: () => boolean
  /** Store tail when the jump was requested: a user message sent since then cancels it. */
  captured: { id?: string; type?: string } | null
  /** Store tail when the load started. */
  tail: TimelineItem | null
}): Promise<void> {
  const res = await fetchSessionHistoryTail(sessionFile, VIEW_REVEAL_CHUNK_LIMIT, {
    leafId: entryId,
    bypassCache: true,
  })
  if (!stillCurrent()) return
  const chunk = (res.items || []) as TimelineItem[]
  if (!chunk.length) return
  if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
  if (isTargetNewerThanStore(chunk, tail)) return

  // The leaf-anchored fetch reports the target's absolute position (branch
  // length). When the loaded tail does not start right above the target, fetch
  // the tail-anchored remainder so the store stays contiguous — otherwise a
  // hole is left between the target region and the tail, corrupting later
  // offset-based older-loading.
  let allFetched: TimelineItem[] = chunk
  const targetPos = typeof res.totalCount === 'number' ? res.totalCount : 0
  const pre = useUIStore.getState()
  const total = pre.historyTotalCount
  if (targetPos > 0 && total > targetPos) {
    const gap = total - targetPos
    // Request up to 500 rows; the tail can extend to a turn's user message.
    const tailRes = await fetchSessionHistoryTail(sessionFile, Math.min(gap, 500), { leafId: null })
    if (!stillCurrent()) return
    if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
    const tailItems = (tailRes.items || []) as TimelineItem[]
    allFetched = [...missingOlderItems(chunk, tailItems), ...tailItems]
    // When the target is further than 500 items below the loaded tail, the
    // gap fetch leaves a hole between the target and the tail. Close it with
    // offset-based pages (max 500 each), oldest-first, looping until the
    // hole is contiguous — a single page would still leave a gap while the
    // loadedCount below claims full coverage and blocks older-loading.
    // Tail pages can extend to the containing user message.
    const holeLength = Math.max(0, gap - tailRes.sourceCount)
    if (holeLength > 0) {
      const middle: TimelineItem[] = []
      let holeStart = targetPos + 1
      let remaining = holeLength
      while (remaining > 0) {
        const pageLen = Math.min(remaining, 500)
        // offset 语义：距尾部倒数第 offset 条之后的 pageLen 条
        const offsetFromTail = total - (holeStart + pageLen - 1)
        const pageRes = await fetchSessionHistoryOlder(sessionFile, offsetFromTail, pageLen)
        if (!stillCurrent()) return
        if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
        const page = (pageRes.items || []) as TimelineItem[]
        if (!page.length) break
        middle.push(...page)
        holeStart += page.length
        remaining -= page.length
      }
      allFetched = [...chunk, ...middle, ...tailItems]
    }
  }
  const latest = useUIStore.getState()
  const missing = missingOlderItems(allFetched, latest.timelineItems)
  if (missing.length) {
    latest.prependHistoryItems(missing)
    const after = useUIStore.getState()
    // Recompute loadedCount from the true coverage: everything from the chunk
    // start (targetPos - chunkLen + 1) through the leaf is now loaded. This
    // keeps the older-loader's offset honest so it never fetches pages that
    // overlap or fall out of order.
    if (after.historyTotalCount > 0) {
      const chunkLen = res.sourceCount
      const covered = after.historyTotalCount - (targetPos - chunkLen)
      useUIStore.setState({
        historyLoadedCount: Math.min(
          after.historyTotalCount,
          Math.max(after.historyLoadedCount, covered),
        ),
      })
    }
  }
}
