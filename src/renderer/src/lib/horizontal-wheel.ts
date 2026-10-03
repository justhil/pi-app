/**
 * Horizontal strip scrolling for a mouse wheel: vertical wheel movement becomes horizontal
 * movement; native horizontal (trackpad) gestures pass through untouched. Returns the px to
 * add to scrollLeft, or null to leave the event alone (so it can scroll the page instead).
 */
export function wheelToHorizontal(
  e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey?: boolean },
  strip: { scrollLeft: number; scrollWidth: number; clientWidth: number },
): number | null {
  if (strip.scrollWidth <= strip.clientWidth + 1) return null
  // A trackpad swipe already scrolls horizontally on its own.
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return null
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? strip.clientWidth : 1
  const delta = e.deltaY * unit
  const max = strip.scrollWidth - strip.clientWidth
  const next = Math.max(0, Math.min(max, strip.scrollLeft + delta))
  return next === strip.scrollLeft ? 0 : next - strip.scrollLeft
}
