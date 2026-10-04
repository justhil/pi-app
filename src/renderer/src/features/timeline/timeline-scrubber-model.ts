// Pure model of the timeline scrubber: one mark per real user message, laid out evenly on
// the rail (order matters, pixel offsets of unrendered history are unknown).

export interface ScrubberMark {
  /** Timeline item id (DOM anchor `data-item-id`). */
  id: string
  /** Session entry id for view jumps (falls back to the item id). */
  entryId: string
  preview: string
}

type ItemLike = { id: string; type: string; text?: string; sessionEntryId?: string }

export function previewText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function scrubberMarks(items: readonly ItemLike[]): ScrubberMark[] {
  const out: ScrubberMark[] = []
  for (const it of items) {
    if (it.type !== 'user-message') continue
    const preview = previewText(String(it.text ?? ''))
    if (!preview) continue
    out.push({ id: it.id, entryId: it.sessionEntryId || it.id, preview })
  }
  return out
}

/** Preferred distance between marks; they sit as a compact group in the middle of the rail. */
export const MARK_GAP = 7

/** Spacing actually used: the preferred gap, squeezed only when the group would not fit. */
function layoutGap(n: number, h: number, pad: number): number {
  if (n <= 1) return 0
  return Math.min(MARK_GAP, (h - pad * 2) / (n - 1))
}

/** Y of mark `i` of `n` on a rail of height `h`: a centred, evenly spaced group. */
export function markY(i: number, n: number, h: number, pad = 6): number {
  const gap = layoutGap(n, h, pad)
  return h / 2 - ((n - 1) * gap) / 2 + i * gap
}

/** Mark nearest to rail position `y` — what hover and drag snap to (clamped to the ends). */
export function nearestMark(y: number, n: number, h: number, pad = 6): number {
  if (n <= 0) return -1
  if (n === 1) return 0
  const gap = layoutGap(n, h, pad)
  const top = h / 2 - ((n - 1) * gap) / 2
  return Math.max(0, Math.min(n - 1, Math.round((y - top) / gap)))
}

/** Hover magnification 0..1 for a mark `dy` px from the pointer (dock-like falloff). */
export function magnify(dy: number, radius = 22): number {
  const d = Math.abs(dy)
  return d >= radius ? 0 : Math.cos((d / radius) * (Math.PI / 2)) ** 2
}

/**
 * Which mark the reader is at: the last rendered user message whose top is above the
 * reading line (40% down the viewport). `tops` holds viewport-relative tops or null
 * for messages outside the render window (they are above everything rendered).
 */
export function activeMark(tops: readonly (number | null)[], readingLine: number): number {
  let active = -1
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i]
    if (top === null) {
      if (active === -1 || active < i) active = i
      continue
    }
    if (top <= readingLine) active = i
    else break
  }
  return Math.max(0, active)
}
