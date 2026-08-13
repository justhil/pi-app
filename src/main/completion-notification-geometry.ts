export const NOTIFICATION_HOST_WIDTH = 380
export const NOTIFICATION_CARD_HEIGHT = 168
export const NOTIFICATION_STACK_GAP = 8
export const NOTIFICATION_HOST_PAD = 16
export const NOTIFICATION_MAX_VISIBLE = 3

export function notificationHostSize(cardCount: number): { width: number; height: number } {
  const n = Math.max(0, Math.min(NOTIFICATION_MAX_VISIBLE, cardCount))
  if (n === 0) return { width: NOTIFICATION_HOST_WIDTH, height: 1 }
  return {
    width: NOTIFICATION_HOST_WIDTH,
    height: n * NOTIFICATION_CARD_HEIGHT + Math.max(0, n - 1) * NOTIFICATION_STACK_GAP + 8,
  }
}

export function notificationHostBounds(
  workArea: { x: number; y: number; width: number; height: number },
  cardCount: number,
): { x: number; y: number; width: number; height: number } {
  const size = notificationHostSize(cardCount)
  return {
    x: workArea.x + workArea.width - size.width - NOTIFICATION_HOST_PAD,
    y: workArea.y + workArea.height - size.height - NOTIFICATION_HOST_PAD,
    width: size.width,
    height: size.height,
  }
}

export function notificationBoundsLookLegal(
  bounds: { x: number; y: number; width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
): boolean {
  if (bounds.width < 100 || bounds.height < 40) return false
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false
  const withinX = bounds.x + bounds.width <= workArea.x + workArea.width + 8
  const withinY = bounds.y + bounds.height <= workArea.y + workArea.height + 8
  return bounds.x >= workArea.x - 8 && bounds.y >= workArea.y - 8 && withinX && withinY
}
