// Browser viewport size: "fit" follows the panel; "fixed" keeps the page's viewport at a chosen
// size, scaled down (never up) when the panel is smaller: centred horizontally, top-aligned
// like a page (a vertically centred page reads as floating).

export type ViewportMode = { kind: 'fit' } | { kind: 'fixed'; width: number; height: number }

export const MIN_VIEWPORT = { width: 320, height: 240 }
export const MAX_VIEWPORT = { width: 3840, height: 2400 }
const KEY = 'pi-browser-viewport-v1'

export function clampViewport(width: number, height: number): { width: number; height: number } {
  const c = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo)))
  return { width: c(width, MIN_VIEWPORT.width, MAX_VIEWPORT.width), height: c(height, MIN_VIEWPORT.height, MAX_VIEWPORT.height) }
}

/** Where the page shows inside the panel area, and the page zoom that keeps its viewport size. */
export function fitViewport(mode: ViewportMode, area: { width: number; height: number }): { width: number; height: number; left: number; top: number; zoom: number } {
  if (mode.kind === 'fit' || area.width <= 0 || area.height <= 0) return { width: area.width, height: area.height, left: 0, top: 0, zoom: 1 }
  const zoom = Math.min(1, area.width / mode.width, area.height / mode.height)
  const width = Math.floor(mode.width * zoom)
  const height = Math.floor(mode.height * zoom)
  return { width, height, left: Math.floor((area.width - width) / 2), top: 0, zoom }
}

export function loadViewportMode(): ViewportMode {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as ViewportMode | null
    if (v?.kind === 'fixed') return { kind: 'fixed', ...clampViewport(v.width, v.height) }
  } catch {
    // default below
  }
  return { kind: 'fit' }
}

export function saveViewportMode(mode: ViewportMode): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mode))
  } catch {
    // per-device convenience only
  }
}
