import type { BrowserViewBounds } from '@shared/browser-types'

export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Renderer placeholder rect → WebContentsView bounds in window DIPs.
 * The Renderer reports CSS px from getBoundingClientRect; the host page may be zoomed
 * (webContents zoom factor), so scale, round outward-safe, and clamp to the content area.
 * Returns null when the view should be hidden.
 */
export function computeViewBounds(
  bounds: Pick<BrowserViewBounds, 'x' | 'y' | 'width' | 'height' | 'visible'>,
  zoomFactor: number,
  content: { width: number; height: number },
): ViewRect | null {
  if (!bounds.visible) return null
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const left = Math.max(0, Math.round(bounds.x * zoom))
  const top = Math.max(0, Math.round(bounds.y * zoom))
  const right = Math.min(content.width, Math.round((bounds.x + bounds.width) * zoom))
  const bottom = Math.min(content.height, Math.round((bounds.y + bounds.height) * zoom))
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null
  return { x: left, y: top, width, height }
}
