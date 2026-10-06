export type ThemeVariantKey = 'light' | 'dark'

export const DISABLE_CUSTOM_THEME_CLI_FLAG = '--disable-custom-theme'
export const CUSTOM_THEME_DISABLED_RENDERER_ARGUMENT = '--pi-custom-theme-disabled=1'
export const CUSTOM_THEME_ENABLED_RENDERER_ARGUMENT = '--pi-custom-theme-disabled=0'

export const CUSTOM_THEME_STYLE_ID = 'pi-custom-theme'
export const CUSTOM_THEME_CSS_CACHE_KEY = 'pi-desktop-theme-css'
export const CUSTOM_CSS_OVERRIDE_STYLE_ID = 'pi-custom-css'
export const CUSTOM_CSS_OVERRIDE_CACHE_KEY = 'pi-desktop-custom-css'

/** 一份变体配置；字段形状取 codex-theme-v1 的 theme 对象超集 */
export type ThemeVariant = {
  /** 预设 id；字段被改动后置 null（= 自定义） */
  preset: string | null
  accent: string
  surface: string
  ink: string
  /** 0-100，surface↔ink 灰阶插值强度 */
  contrast: number
  /** 本机字体名，前置到默认栈之前；null = 默认栈 */
  fontUi: string | null
  fontCode: string | null
  /** codex opaqueWindows 取反 */
  translucentSidebar: boolean
  diffAdded?: string
  diffRemoved?: string
  /** Surface overrides; a missing key = derived from surface / ink. */
  colors?: ThemeColorOverrides
  /** Headings (and prose, see `proseFont`): a local font name, or `serif` for the built-in serif stack. */
  fontDisplay?: string | null
  /** Assistant prose in the UI font or the display font. */
  proseFont?: 'ui' | 'display'
  /** Chat text size (px) and line height. */
  chatFontSize?: number
  chatLineHeight?: number
  /** Corner radius base (px), 0–16. */
  radius?: number
  /** Shadow strength 0–100 (50 = default). */
  shadow?: number
}

export type ThemeColorOverrides = { sidebar?: string; chat?: string; userBubble?: string; codeBg?: string; border?: string }
export const THEME_COLOR_KEYS = ['sidebar', 'chat', 'userBubble', 'codeBg', 'border'] as const

export const THEME_LIMITS = {
  chatFontSize: [12, 18],
  chatLineHeight: [1.3, 2],
  radius: [0, 16],
  shadow: [0, 100],
} as const

/** 槽位缺省 = 该变体未定制 */
export type CustomTheme = { light?: ThemeVariant; dark?: ThemeVariant }

/** 自由 CSS 是结构化主题之后的独立覆盖层。 */
export type CustomCssOverride = {
  enabled: boolean
  css: string
}

export const DEFAULT_CUSTOM_CSS_OVERRIDE: CustomCssOverride = { enabled: false, css: '' }
export const DEFAULT_THEME_CONTRAST: Record<ThemeVariantKey, number> = { light: 45, dark: 60 }

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** 只接受 #rgb / #rrggbb，统一展开为小写 #rrggbb */
export function normalizeHexColor(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!HEX_COLOR_RE.test(s)) return null
  if (s.length === 7) return s
  return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
}

/** 本机字体名：去掉能撑破 CSS 声明的字符，空串归一为 null */
export function normalizeFontName(raw: unknown): string | null {
  let sanitized = ''
  for (const char of String(raw ?? '')) {
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

export function normalizeThemeVariant(raw: unknown, key: ThemeVariantKey): ThemeVariant | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const accent = normalizeHexColor(v.accent)
  const surface = normalizeHexColor(v.surface)
  const ink = normalizeHexColor(v.ink)
  if (!accent || !surface || !ink) return null

  const contrastRaw = typeof v.contrast === 'number' ? v.contrast : Number(v.contrast)
  const contrast = Number.isFinite(contrastRaw)
    ? Math.min(100, Math.max(0, contrastRaw))
    : DEFAULT_THEME_CONTRAST[key]
  const diffAdded = normalizeHexColor(v.diffAdded)
  const diffRemoved = normalizeHexColor(v.diffRemoved)
  const extras = normalizeThemeExtras(v)

  return {
    preset: typeof v.preset === 'string' ? v.preset : null,
    accent,
    surface,
    ink,
    contrast,
    fontUi: normalizeFontName(v.fontUi),
    fontCode: normalizeFontName(v.fontCode),
    translucentSidebar: v.translucentSidebar === true,
    ...(diffAdded ? { diffAdded } : {}),
    ...(diffRemoved ? { diffRemoved } : {}),
    ...extras,
  }
}

function clampNumber(raw: unknown, [min, max]: readonly [number, number]): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

/** The optional fields added after v1 (colors, typography, shape); invalid values are dropped. */
export function normalizeThemeExtras(v: Record<string, unknown>): Partial<ThemeVariant> {
  const out: Partial<ThemeVariant> = {}
  if (v.colors && typeof v.colors === 'object') {
    const src = v.colors as Record<string, unknown>
    const colors: ThemeColorOverrides = {}
    for (const k of THEME_COLOR_KEYS) {
      const c = normalizeHexColor(src[k])
      if (c) colors[k] = c
    }
    if (Object.keys(colors).length) out.colors = colors
  }
  const display = v.fontDisplay === 'serif' ? 'serif' : normalizeFontName(v.fontDisplay)
  if (display) out.fontDisplay = display
  if (v.proseFont === 'ui' || v.proseFont === 'display') out.proseFont = v.proseFont
  for (const k of ['chatFontSize', 'chatLineHeight', 'radius', 'shadow'] as const) {
    const n = clampNumber(v[k], THEME_LIMITS[k])
    if (n !== undefined) out[k] = k === 'chatLineHeight' ? Math.round(n * 100) / 100 : Math.round(n)
  }
  return out
}

export function normalizeCustomTheme(raw: unknown): CustomTheme {
  if (!raw || typeof raw !== 'object') return {}
  const t = raw as Record<string, unknown>
  const light = normalizeThemeVariant(t.light, 'light')
  const dark = normalizeThemeVariant(t.dark, 'dark')
  return {
    ...(light ? { light } : {}),
    ...(dark ? { dark } : {}),
  }
}

export function normalizeCustomCssOverride(raw: unknown): CustomCssOverride {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CUSTOM_CSS_OVERRIDE }
  const value = raw as Record<string, unknown>
  return {
    enabled: value.enabled === true,
    css: typeof value.css === 'string' ? value.css : '',
  }
}
