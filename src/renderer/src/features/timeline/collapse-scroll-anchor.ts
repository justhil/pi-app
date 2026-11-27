/**
 * Keep the viewport anchored when collapsing a tall expanded block whose header has scrolled
 * above the visible pane. If the header is already visible, leave scrollTop untouched.
 */
export function anchorViewportBeforeCollapse(targetEl: HTMLElement | null, topPaddingPx = 12): void {
  if (!targetEl) return
  const scrollPane =
    targetEl.closest<HTMLElement>('.timeline-scroll-with-dock-pane, [data-overlay-scroll-pane]') ??
    targetEl.closest<HTMLElement>('.timeline-scroll-viewport')
  if (!scrollPane) return
  const paneRect = scrollPane.getBoundingClientRect()
  const targetRect = targetEl.getBoundingClientRect()
  if (targetRect.top < paneRect.top + topPaddingPx) {
    const scale = scrollPane.offsetHeight > 0 ? paneRect.height / scrollPane.offsetHeight : 1
    const delta = (targetRect.top - (paneRect.top + topPaddingPx)) / (scale || 1)
    scrollPane.scrollTop = Math.max(0, scrollPane.scrollTop + delta)
  }
}
