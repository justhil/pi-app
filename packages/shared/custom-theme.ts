export type ThemeVariantKey = 'light' | 'dark'

export const THEME_COLOR_KEYS = ['sidebar', 'chat', 'userBubble', 'codeBg', 'border'] as const
export type ThemeColorOverrides = Partial<Record<(typeof THEME_COLOR_KEYS)[number], string>>

export const FRAME_STYLES = ['paper', 'island', 'flat'] as const
export type ThemeFrameStyle = (typeof FRAME_STYLES)[number]

export const MESSAGE_STYLES = ['bubble', 'editorial', 'card'] as const
export type ThemeMessageStyle = (typeof MESSAGE_STYLES)[number]

export const THEME_DENSITIES = ['compact', 'default', 'relaxed'] as const
export type ThemeDensity = (typeof THEME_DENSITIES)[number]

export const ACCENT_PRESENCES = ['subtle', 'balanced', 'vivid'] as const
export type ThemeAccentPresence = (typeof ACCENT_PRESENCES)[number]

export const SURFACE_MATERIALS = ['solid', 'bevel', 'frosted', 'liquid-glass'] as const
export type ThemeSurfaceMaterial = (typeof SURFACE_MATERIALS)[number]

export const WINDOW_MATERIALS = ['none', 'mica', 'acrylic', 'tabbed'] as const
export type ThemeWindowMaterial = (typeof WINDOW_MATERIALS)[number]

export const BACKDROP_PRESETS = ['none', 'ambient', 'dots', 'grid', 'grain'] as const
export type ThemeBackdropPreset = (typeof BACKDROP_PRESETS)[number]

export const SHIKI_THEME_IDS = [
  'github-light',
  'github-dark',
  'vitesse-light',
  'vitesse-dark',
  'everforest-light',
  'everforest-dark',
  'catppuccin-latte',
  'catppuccin-mocha',
  'rose-pine-dawn',
  'rose-pine',
  'tokyo-night',
  'kanagawa-wave',
  'vesper',
  'nord',
  'one-dark-pro',
] as const
export type ShikiThemeId = (typeof SHIKI_THEME_IDS)[number]

export type ThemeVariant = {
  preset: string | null
  accent: string
  surface: string
  ink: string
  contrast: number
  fontUi: string | null
  fontCode: string | null
  translucentSidebar: boolean
  diffAdded?: string
  diffRemoved?: string
  /** Optional per-surface hex overrides; unset keys stay derived from surface/ink. */
  colors?: ThemeColorOverrides
  /** `'serif'` uses the built-in serif stack; any other string is a family name; unset = UI font. */
  fontDisplay?: string
  /** `'display'` sets assistant prose in the display font; `'ui'` or unset keeps UI sans. */
  proseFont?: 'ui' | 'display'
  /** Assistant prose size in px, 12–18. */
  chatFontSize?: number
  /** Assistant prose line-height, 1.3–2.0. */
  chatLineHeight?: number
  /** Base control radius in px, 0–20; paper radius scales with it. */
  radius?: number
  /** Paper shadow strength, 0 (flat) – 100. */
  shadow?: number

  /* ---- Render FX, Layout & Syntax Primitives ---- */
  /** Workbench shell geometry: default paper corner, floating island panes, or sharp flat IDE split. */
  frameStyle?: ThemeFrameStyle
  /** Conversation row presentation: right bubble, left-accent editorial bar, or bordered cards. */
  messageStyle?: ThemeMessageStyle
  /** Max prose column width in px (640–1400), or `0` for 100% full width. */
  contentWidth?: number
  /** Global spacing density across sidebar, timeline, and tool rows. */
  density?: ThemeDensity
  /** How strongly `--brand` participates in active indicators, user bars, tabs, and primary actions. */
  accentPresence?: ThemeAccentPresence
  /** Optical surface treatment for floating chrome (Composer dock, popovers, overlays, pills). */
  surfaceMaterial?: ThemeSurfaceMaterial
  /** Native OS compositor backdrop (Win11 Mica/Acrylic/Tabbed, macOS Vibrancy). */
  windowMaterial?: ThemeWindowMaterial
  /** Edge lens refraction scale (0–48) when `surfaceMaterial === 'liquid-glass'`. */
  glassRefraction?: number
  /** Backdrop frost blur radius in px (0–28) for `frosted` / `liquid-glass`. */
  glassFrost?: number
  /** Tint opacity (0.15–0.96) for translucent chrome surfaces. */
  glassTintAlpha?: number
  /** Asymmetric top specular rim intensity (0–1). */
  glassSpecular?: number
  /** Subtle chromatic rim dispersion highlight on liquid glass edges. */
  glassDispersion?: boolean
  /** Built-in procedural backdrop stage (requires zero external wallpaper images). */
  backdropPreset?: ThemeBackdropPreset
  /** Procedural backdrop strength (0.05–1). */
  backdropIntensity?: number
  /** Syntax highlighting theme for chat and file preview code blocks. */
  codeTheme?: ShikiThemeId
}

export type CustomTheme = {
  light?: ThemeVariant
  dark?: ThemeVariant
}

export type CustomCssOverride = {
  enabled: boolean
  css: string
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {}

export const DEFAULT_CUSTOM_CSS_OVERRIDE: CustomCssOverride = {
  enabled: false,
  css: '',
}

export const DEFAULT_THEME_CONTRAST: Record<ThemeVariantKey, number> = {
  light: 45,
  dark: 60,
}

export const CUSTOM_THEME_CSS_CACHE_KEY = 'pi-desktop-theme-css'
export const CUSTOM_CSS_OVERRIDE_CACHE_KEY = 'pi-desktop-custom-css'
export const CUSTOM_THEME_STYLE_ID = 'pi-custom-theme'
export const CUSTOM_CSS_OVERRIDE_STYLE_ID = 'pi-custom-css'
export const CUSTOM_SNIPPETS_STYLE_ID = 'pi-custom-snippets'
export const DISABLE_CUSTOM_THEME_CLI_FLAG = '--disable-custom-theme'
export const CUSTOM_THEME_DISABLED_RENDERER_ARGUMENT = '--pi-custom-theme-disabled=1'
export const CUSTOM_THEME_ENABLED_RENDERER_ARGUMENT = '--pi-custom-theme-disabled=0'
export const MAX_CUSTOM_CSS_LENGTH = 50_000

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function expandHexColor(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return value
}

export function normalizeHexColor(raw: unknown): string | null {
  if (typeof raw !== 'string' || !HEX_COLOR_RE.test(raw.trim())) return null
  return expandHexColor(raw)
}

export function normalizeFontName(raw: unknown): string | null {
  if (raw == null) return null
  let sanitized = ''
  for (const char of String(raw)) {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127) {
      if (/\s/.test(char)) sanitized += ' '
      continue
    }
    if (`"'\\;{}<>`.includes(char)) continue
    sanitized += char
  }
  const name = sanitized.replace(/\s+/g, ' ').trim()
  return name ? name.slice(0, 80) : null
}

function clampRange(raw: unknown, min: number, max: number, round = true): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(n)) return undefined
  const c = Math.min(max, Math.max(min, n))
  return round ? Math.round(c) : Math.round(c * 100) / 100
}

function pickEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
}

export function normalizeThemeExtras(raw: Record<string, unknown>): Partial<ThemeVariant> {
  const out: Partial<ThemeVariant> = {}
  if (raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors)) {
    const src = raw.colors as Record<string, unknown>
    const colors: ThemeColorOverrides = {}
    for (const key of THEME_COLOR_KEYS) {
      const hex = normalizeHexColor(src[key])
      if (hex) colors[key] = hex
    }
    if (Object.keys(colors).length) out.colors = colors
  }
  const fontDisplay = raw.fontDisplay === 'serif' ? 'serif' : normalizeFontName(raw.fontDisplay)
  if (fontDisplay) out.fontDisplay = fontDisplay
  if (raw.proseFont === 'ui' || raw.proseFont === 'display') out.proseFont = raw.proseFont
  const chatFontSize = clampRange(raw.chatFontSize, 12, 18)
  if (chatFontSize !== undefined) out.chatFontSize = chatFontSize
  const chatLineHeight = clampRange(raw.chatLineHeight, 1.3, 2, false)
  if (chatLineHeight !== undefined) out.chatLineHeight = chatLineHeight
  const radius = clampRange(raw.radius, 0, 20)
  if (radius !== undefined) out.radius = radius
  const shadow = clampRange(raw.shadow, 0, 100)
  if (shadow !== undefined) out.shadow = shadow

  const frameStyle = pickEnum(raw.frameStyle, FRAME_STYLES)
  if (frameStyle) out.frameStyle = frameStyle
  const messageStyle = pickEnum(raw.messageStyle, MESSAGE_STYLES)
  if (messageStyle) out.messageStyle = messageStyle
  if (raw.contentWidth === 0 || raw.contentWidth === '0') {
    out.contentWidth = 0
  } else {
    const contentWidth = clampRange(raw.contentWidth, 640, 1400)
    if (contentWidth !== undefined) out.contentWidth = contentWidth
  }
  const density = pickEnum(raw.density, THEME_DENSITIES)
  if (density) out.density = density
  const accentPresence = pickEnum(raw.accentPresence, ACCENT_PRESENCES)
  if (accentPresence) out.accentPresence = accentPresence

  const surfaceMaterial = pickEnum(raw.surfaceMaterial, SURFACE_MATERIALS)
  if (surfaceMaterial) out.surfaceMaterial = surfaceMaterial
  const windowMaterial = pickEnum(raw.windowMaterial, WINDOW_MATERIALS)
  if (windowMaterial) out.windowMaterial = windowMaterial
  const glassRefraction = clampRange(raw.glassRefraction, 0, 48)
  if (glassRefraction !== undefined) out.glassRefraction = glassRefraction
  const glassFrost = clampRange(raw.glassFrost, 0, 28)
  if (glassFrost !== undefined) out.glassFrost = glassFrost
  const glassTintAlpha = clampRange(raw.glassTintAlpha, 0.15, 0.96, false)
  if (glassTintAlpha !== undefined) out.glassTintAlpha = glassTintAlpha
  const glassSpecular = clampRange(raw.glassSpecular, 0, 1, false)
  if (glassSpecular !== undefined) out.glassSpecular = glassSpecular
  if (typeof raw.glassDispersion === 'boolean') out.glassDispersion = raw.glassDispersion

  const backdropPreset = pickEnum(raw.backdropPreset, BACKDROP_PRESETS)
  if (backdropPreset) out.backdropPreset = backdropPreset
  const backdropIntensity = clampRange(raw.backdropIntensity, 0.05, 1, false)
  if (backdropIntensity !== undefined) out.backdropIntensity = backdropIntensity

  const codeTheme = pickEnum(raw.codeTheme, SHIKI_THEME_IDS)
  if (codeTheme) out.codeTheme = codeTheme

  return out
}

export function normalizeThemeVariant(raw: unknown, variant: ThemeVariantKey): ThemeVariant | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const accent = normalizeHexColor(value.accent)
  const surface = normalizeHexColor(value.surface)
  const ink = normalizeHexColor(value.ink)
  if (!accent || !surface || !ink) return undefined

  const contrastRaw = typeof value.contrast === 'number' ? value.contrast : Number(value.contrast)
  const contrast = Number.isFinite(contrastRaw)
    ? Math.min(100, Math.max(0, contrastRaw))
    : DEFAULT_THEME_CONTRAST[variant]

  const diffAdded = normalizeHexColor(value.diffAdded) ?? undefined
  const diffRemoved = normalizeHexColor(value.diffRemoved) ?? undefined
  const preset = typeof value.preset === 'string' && value.preset.trim() ? value.preset.trim() : null

  return {
    preset,
    accent,
    surface,
    ink,
    contrast,
    fontUi: normalizeFontName(value.fontUi),
    fontCode: normalizeFontName(value.fontCode),
    translucentSidebar: typeof value.translucentSidebar === 'boolean' ? value.translucentSidebar : true,
    ...(diffAdded ? { diffAdded } : {}),
    ...(diffRemoved ? { diffRemoved } : {}),
    ...normalizeThemeExtras(value),
  }
}

export function normalizeCustomTheme(raw: unknown): CustomTheme {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const light = normalizeThemeVariant(value.light, 'light')
  const dark = normalizeThemeVariant(value.dark, 'dark')
  return {
    ...(light ? { light } : {}),
    ...(dark ? { dark } : {}),
  }
}

export function normalizeCustomCssOverride(raw: unknown): CustomCssOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_CUSTOM_CSS_OVERRIDE }
  }
  const value = raw as Record<string, unknown>
  const css = typeof value.css === 'string' ? value.css.slice(0, MAX_CUSTOM_CSS_LENGTH) : ''
  return {
    enabled: Boolean(value.enabled),
    css,
  }
}
