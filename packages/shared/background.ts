/** One background image and how it sits behind the window (Settings → Appearance → Background). */
export type BackgroundImage = {
  /** File name inside `<userData>/backgrounds/` (the picked image is copied there). */
  file: string
  /** How strongly the image shows, 0.05–1. */
  opacity: number
  /** Image blur in px, 0–24. */
  blur: number
  /** Opacity of the panes over it (sidebar, chat, panels), 0.5–1. */
  uiOpacity: number
  fit: 'cover' | 'contain' | 'tile' | 'center'
  position: 'center' | 'top' | 'bottom'
  /** Image brightness 0.4–1.3 and saturation 0–1.6 (1 = unchanged); a soft dark vignette at the edges. */
  brightness: number
  saturation: number
  vignette: boolean
  /** How the panes over the image look; blur of what is seen through them (px, 0–40). */
  material: PaneMaterial
  paneBlur: number
  /**
   * Off: the content panes (chat, right panel, terminal) sit on the window tint — mostly solid.
   * On: every pane is its own layer over the image, so the image shows through the whole interface.
   */
  fullCover: boolean
  /** Chat column, right panel and terminal tuned on their own; absent = same as the rest. */
  content?: PaneLayer
}

/** frosted: blur · glass: liquid glass (blur, saturation boost, light edge and sheen) · clear: tint only */
export type PaneMaterial = 'frosted' | 'glass' | 'clear'
export type PaneLayer = { uiOpacity: number; paneBlur: number; material: PaneMaterial }

/** `shared`: the light image is used in dark mode too. */
export type BackgroundSettings = { light?: BackgroundImage; dark?: BackgroundImage; shared: boolean }

export const DEFAULT_BACKGROUND: BackgroundSettings = { shared: true }
export const BACKGROUND_DEFAULTS: Omit<BackgroundImage, 'file'> = {
  opacity: 0.6,
  blur: 0,
  uiOpacity: 0.8,
  fit: 'cover',
  position: 'center',
  brightness: 1,
  saturation: 1,
  vignette: false,
  material: 'frosted',
  paneBlur: 16,
  fullCover: false,
}
export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024
export const BACKGROUND_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] as const

const FILE_RE = /^[a-f0-9]{16,64}\.(png|jpe?g|webp|gif|avif)$/

const clamp = (raw: unknown, min: number, max: number, def: number) => {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

const material = (v: unknown): PaneMaterial => (v === 'glass' || v === 'clear' ? v : 'frosted')

function normalizeLayer(raw: unknown): PaneLayer | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  const d = BACKGROUND_DEFAULTS
  return { uiOpacity: clamp(v.uiOpacity, 0.3, 1, d.uiOpacity), paneBlur: Math.round(clamp(v.paneBlur, 0, 40, d.paneBlur)), material: material(v.material) }
}

export function normalizeBackgroundImage(raw: unknown): BackgroundImage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  if (typeof v.file !== 'string' || !FILE_RE.test(v.file)) return undefined
  const d = BACKGROUND_DEFAULTS
  return {
    file: v.file,
    opacity: clamp(v.opacity, 0.05, 1, d.opacity),
    blur: Math.round(clamp(v.blur, 0, 24, d.blur)),
    uiOpacity: clamp(v.uiOpacity, 0.5, 1, d.uiOpacity),
    fit: v.fit === 'contain' || v.fit === 'tile' || v.fit === 'center' ? v.fit : 'cover',
    position: v.position === 'top' || v.position === 'bottom' ? v.position : 'center',
    brightness: clamp(v.brightness, 0.4, 1.3, d.brightness),
    saturation: clamp(v.saturation, 0, 1.6, d.saturation),
    vignette: v.vignette === true,
    material: material(v.material),
    paneBlur: Math.round(clamp(v.paneBlur, 0, 40, d.paneBlur)),
    fullCover: v.fullCover === true,
    ...(normalizeLayer(v.content) ? { content: normalizeLayer(v.content) } : {}),
  }
}

export function normalizeBackground(raw: unknown): BackgroundSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BACKGROUND }
  const v = raw as Record<string, unknown>
  const light = normalizeBackgroundImage(v.light)
  const dark = normalizeBackgroundImage(v.dark)
  return { shared: v.shared !== false, ...(light ? { light } : {}), ...(dark ? { dark } : {}) }
}

/** The image for the current light / dark mode, if any. */
export function activeBackground(bg: BackgroundSettings, dark: boolean): BackgroundImage | undefined {
  return bg.shared || !dark ? bg.light : bg.dark
}

/** Image files a background setting refers to (for pruning the folder). */
export function backgroundFiles(bg: BackgroundSettings): string[] {
  return [bg.light?.file, bg.dark?.file].filter((f): f is string => !!f)
}
