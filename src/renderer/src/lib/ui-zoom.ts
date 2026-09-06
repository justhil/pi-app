const KEY = 'pi-desktop:ui-zoom'

export function readUiZoom(): number {
  const n = Number(localStorage.getItem(KEY) || '1')
  if (n === 0.9 || n === 1 || n === 1.1) return n
  return 1
}

export function applyUiZoom(n: number): void {
  const zoom = n === 0.9 || n === 1.1 ? n : 1
  localStorage.setItem(KEY, String(zoom))
  document.documentElement.style.zoom = String(zoom)
  document.documentElement.style.setProperty('--ui-zoom', String(zoom))
  window.dispatchEvent(new Event('resize'))
}
