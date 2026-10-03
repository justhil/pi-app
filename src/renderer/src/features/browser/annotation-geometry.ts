export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Below this many px of pointer travel a press is a click (pick element), above it an area drag. */
export const DRAG_THRESHOLD_PX = 6

export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

export function isDrag(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.hypot(bx - ax, by - ay) >= DRAG_THRESHOLD_PX
}

/**
 * Region of the frozen screenshot to keep for an annotation: the target plus some context,
 * clamped to the frame, in screenshot pixels (`scale` = image px per overlay px).
 */
export function cropRect(target: Rect, frame: { width: number; height: number }, scale: number, padding = 32): Rect {
  const x = Math.max(0, Math.floor((target.x - padding) * scale))
  const y = Math.max(0, Math.floor((target.y - padding) * scale))
  const right = Math.min(frame.width * scale, Math.ceil((target.x + target.width + padding) * scale))
  const bottom = Math.min(frame.height * scale, Math.ceil((target.y + target.height + padding) * scale))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

export interface StackItem {
  width: number
  height: number
}

/** Vertical stack of crops scaled down to `maxWidth`, with a label strip above each. */
export function stackLayout(items: StackItem[], maxWidth = 1000, gap = 16, labelHeight = 28) {
  const width = Math.min(maxWidth, Math.max(1, ...items.map((i) => i.width)))
  let y = 0
  const placed = items.map((item) => {
    const s = Math.min(1, width / item.width)
    const box = { labelY: y, x: 0, y: y + labelHeight, width: Math.round(item.width * s), height: Math.round(item.height * s) }
    y = box.y + box.height + gap
    return box
  })
  return { width, height: Math.max(1, y - gap), placed }
}

/** Keep a floating box (comment editor) inside the frame, preferring below the target. */
export function placeBeside(target: Rect, box: { width: number; height: number }, frame: { width: number; height: number }, gap = 8) {
  const below = target.y + target.height + gap
  const y = below + box.height <= frame.height ? below : Math.max(0, target.y - gap - box.height)
  const x = Math.min(Math.max(0, target.x), Math.max(0, frame.width - box.width))
  return { x, y: Math.min(y, Math.max(0, frame.height - box.height)) }
}
