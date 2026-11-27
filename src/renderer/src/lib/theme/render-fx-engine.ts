import {
  CUSTOM_SNIPPETS_STYLE_ID,
  type CustomTheme,
  type ShikiThemeId,
  type ThemeVariant,
  type ThemeWindowMaterial,
} from '@shared/custom-theme'
import { buildActiveSnippetsPayload, type CssSnippetItem } from '@shared/theme-pack'
import { ipcClient } from '@renderer/lib/ipc-client'
import { isCustomThemeDisabled } from './theme-runtime-state'

const SVG_DEFS_ID = 'pi-fx-defs'
const BACKDROP_STAGE_ID = 'pi-fx-backdrop'

let activeThemeState: CustomTheme = {}
let darkObserver: MutationObserver | null = null
let cachedLensDataUrl: string | null = null
let lastAppliedWindowMaterial: ThemeWindowMaterial = 'none'
let activeSnippetClasses: string[] = []

type CodeThemeListener = (themeId: ShikiThemeId | null) => void
const codeThemeListeners = new Set<CodeThemeListener>()
let currentResolvedCodeTheme: ShikiThemeId | null = null

export function getActiveCodeTheme(): ShikiThemeId | null {
  return currentResolvedCodeTheme
}

export function onActiveCodeThemeChange(fn: CodeThemeListener): () => void {
  codeThemeListeners.add(fn)
  return () => {
    codeThemeListeners.delete(fn)
  }
}

function setResolvedCodeTheme(next: ShikiThemeId | null): void {
  if (currentResolvedCodeTheme === next) return
  currentResolvedCodeTheme = next
  for (const fn of codeThemeListeners) {
    try {
      fn(next)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Generates an edge-only Snell's-law convex bevel displacement map once on an offscreen canvas.
 * Center pixels stay flat `rgb(128,128,128)` (zero text distortion), while the outer bevel bends
 * backdrop rays smoothly inward along the rounded-rect normal.
 */
export function getLiquidLensDisplacementDataUrl(): string {
  if (cachedLensDataUrl !== null) return cachedLensDataUrl
  if (typeof document === 'undefined') return ''
  // Avoid noisy jsdom not-implemented stderr in unit tests while keeping a valid SVG lens fallback.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
    cachedLensDataUrl =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='rgb(128,128,128)'/%3E%3C/svg%3E"
    return cachedLensDataUrl
  }
  const w = 240
  const h = 120
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    cachedLensDataUrl = ''
    return ''
  }

  let img: ImageData
  try {
    img = ctx.createImageData(w, h)
  } catch {
    cachedLensDataUrl = ''
    return ''
  }

  const data = img.data
  const cornerR = 26
  const bezelPx = 22
  const halfW = w / 2
  const halfH = h / 2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Signed distance to rounded rectangle boundary
      const qx = Math.abs(x + 0.5 - halfW) - (halfW - cornerR)
      const qy = Math.abs(y + 0.5 - halfH) - (halfH - cornerR)
      const outX = Math.max(qx, 0)
      const outY = Math.max(qy, 0)
      const outLen = Math.hypot(outX, outY)
      const sd = Math.min(Math.max(qx, qy), 0) + outLen - cornerR
      const distInside = -sd

      let r = 128
      let g = 128

      if (distInside > 0 && distInside < bezelPx) {
        // Outward normal of rounded rect
        let nx = 0
        let ny = 0
        if (outLen > 1e-4) {
          nx = (outX / outLen) * Math.sign(x + 0.5 - halfW)
          ny = (outY / outLen) * Math.sign(y + 0.5 - halfH)
        } else if (qx > qy) {
          nx = Math.sign(x + 0.5 - halfW)
        } else {
          ny = Math.sign(y + 0.5 - halfH)
        }

        // Smooth Hermite lens slope: 0 at inner boundary, 1 at outer rim
        const t = 1 - distInside / bezelPx
        const slope = t * t * (3 - 2 * t)
        // Refract inward (pull backdrop along -normal near edges like a convex glass slab)
        r = Math.max(0, Math.min(255, Math.round(128 - nx * slope * 124)))
        g = Math.max(0, Math.min(255, Math.round(128 - ny * slope * 124)))
      }

      const idx = (y * w + x) * 4
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = 128
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)
  try {
    cachedLensDataUrl = canvas.toDataURL('image/png')
  } catch {
    cachedLensDataUrl = ''
  }
  return cachedLensDataUrl
}

function ensureLiquidGlassSvgFilter(refractionScale: number, frostPx: number): void {
  if (typeof document === 'undefined' || !document.body) return
  const scale = Math.max(0, Math.min(48, Math.round(refractionScale)))
  if (scale <= 0) {
    document.getElementById(SVG_DEFS_ID)?.remove()
    return
  }

  const mapHref = getLiquidLensDisplacementDataUrl()
  if (!mapHref) return

  const stdDev = Math.max(0, Math.min(24, Number.isFinite(frostPx) ? frostPx * 0.55 : 5)).toFixed(1)

  let svg = document.getElementById(SVG_DEFS_ID) as SVGSVGElement | null
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = SVG_DEFS_ID
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'fixed'
    svg.style.pointerEvents = 'none'
    svg.style.width = '0'
    svg.style.height = '0'
    document.body.prepend(svg)
  }

  // CRITICAL: Filter bounds MUST stay strictly `x="0%" y="0%" width="100%" height="100%"` and blur MUST
  // use `edgeMode="duplicate"` BEFORE inward lens displacement — otherwise Chromium samples premultiplied
  // rgba(0,0,0,0) outside the backdrop box and smears a dark grey halo around light-mode glass edges!
  svg.innerHTML = `<defs><filter id="pi-liquid-lens" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${stdDev}" edgeMode="duplicate" result="frosted"/><feColorMatrix in="frosted" type="saturate" values="1.65" result="vivid"/><feImage href="${mapHref}" x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="lensMap"/><feDisplacementMap in="vivid" in2="lensMap" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="refracted"/><feComponentTransfer in="refracted"><feFuncA type="table" tableValues="1 1"/></feComponentTransfer></filter></defs>`
}

function ensureBackdropStageElement(active: boolean): void {
  if (typeof document === 'undefined' || !document.body) return
  const existing = document.getElementById(BACKDROP_STAGE_ID)
  if (!active) {
    existing?.remove()
    return
  }
  if (!existing) {
    const el = document.createElement('div')
    el.id = BACKDROP_STAGE_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.prepend(el)
  }
}

function syncOsWindowMaterial(requested: ThemeWindowMaterial): void {
  const root = document.documentElement
  if (requested === lastAppliedWindowMaterial) {
    if (requested === 'none') root.removeAttribute('data-win-material')
    return
  }
  lastAppliedWindowMaterial = requested
  if (requested === 'none') {
    root.removeAttribute('data-win-material')
  }
  if (typeof window === 'undefined' || !window.piDesktop) return
  void ipcClient
    .invoke('window.setMaterial', { material: requested })
    .then((res) => {
      if (lastAppliedWindowMaterial !== requested) return
      if (res?.applied && res.effective !== 'none') {
        root.setAttribute('data-win-material', res.effective)
      } else {
        root.removeAttribute('data-win-material')
      }
    })
    .catch(() => {
      root.removeAttribute('data-win-material')
    })
}

const DATA_ATTRS = [
  'data-frame-style',
  'data-msg-style',
  'data-density',
  'data-accent-presence',
  'data-surface-material',
  'data-glass-dispersion',
  'data-backdrop-preset',
] as const

function setOrClearAttr(root: HTMLElement, name: string, value: string | undefined, defaultVal?: string): void {
  if (!value || value === defaultVal) root.removeAttribute(name)
  else root.setAttribute(name, value)
}

function syncActiveVariantDom(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  if (isCustomThemeDisabled()) {
    for (const a of DATA_ATTRS) root.removeAttribute(a)
    ensureLiquidGlassSvgFilter(0, 0)
    ensureBackdropStageElement(false)
    syncOsWindowMaterial('none')
    setResolvedCodeTheme(null)
    return
  }

  const isDark = root.classList.contains('dark')
  const v: ThemeVariant | undefined = isDark ? activeThemeState.dark : activeThemeState.light

  setOrClearAttr(root, 'data-frame-style', v?.frameStyle, 'paper')
  setOrClearAttr(root, 'data-msg-style', v?.messageStyle, 'bubble')
  setOrClearAttr(root, 'data-density', v?.density, 'default')
  setOrClearAttr(root, 'data-accent-presence', v?.accentPresence, 'subtle')
  setOrClearAttr(root, 'data-surface-material', v?.surfaceMaterial, 'solid')
  setOrClearAttr(root, 'data-glass-dispersion', v?.glassDispersion ? 'on' : undefined)
  setOrClearAttr(root, 'data-backdrop-preset', v?.backdropPreset, 'none')

  const isLiquid = v?.surfaceMaterial === 'liquid-glass'
  ensureLiquidGlassSvgFilter(isLiquid ? (v?.glassRefraction ?? 22) : 0, v?.glassFrost ?? 10)
  ensureBackdropStageElement(Boolean(v?.backdropPreset && v.backdropPreset !== 'none'))
  syncOsWindowMaterial(v?.windowMaterial ?? 'none')
  setResolvedCodeTheme(v?.codeTheme ?? null)
}

export function applyRenderFxForTheme(theme: CustomTheme): void {
  activeThemeState = theme
  if (typeof document !== 'undefined' && !darkObserver) {
    darkObserver = new MutationObserver(() => syncActiveVariantDom())
    darkObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }
  syncActiveVariantDom()
}

export function injectCssSnippets(snippets: readonly CssSnippetItem[]): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const existing = document.getElementById(CUSTOM_SNIPPETS_STYLE_ID)

  for (const cls of activeSnippetClasses) {
    root.classList.remove(cls)
  }
  activeSnippetClasses = []

  if (isCustomThemeDisabled()) {
    existing?.remove()
    return
  }

  const { css, classes } = buildActiveSnippetsPayload(snippets)
  for (const cls of classes) {
    root.classList.add(cls)
  }
  activeSnippetClasses = classes

  if (!css.trim()) {
    existing?.remove()
    return
  }

  const style = existing ?? document.createElement('style')
  style.id = CUSTOM_SNIPPETS_STYLE_ID
  style.textContent = css
  if (!style.isConnected) {
    document.head.appendChild(style)
  }
}

export async function hydrateSnippetsFromDisk(): Promise<void> {
  if (typeof window === 'undefined' || !window.piDesktop) return
  try {
    const res = await ipcClient.invoke('snippets.list', {})
    injectCssSnippets(res?.items ?? [])
  } catch {
    /* ignore */
  }
}
