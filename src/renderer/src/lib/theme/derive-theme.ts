import type { ThemeVariant } from '@shared/custom-theme'

/**
 * 变量输出格式（R2）：globals.css 并存两套取值体系，写错不会报错只会静默失效。
 * - hex          自研族，`var(--x)` 直接消费（#rrggbb / 半透明时 #rrggbbaa）
 * - hsl-triplet  shadcn 族，`hsl(var(--x))` 消费，值是裸三元组 `H S% L%`
 * - raw          字体栈等原样串
 */
export type ThemeVarFormat = 'hex' | 'hsl-triplet' | 'raw'

export type ThemeVar = {
  name: string
  value: string
  format: ThemeVarFormat
}

type Rgb = { r: number; g: number; b: number }
type Oklab = { L: number; a: number; b: number }

/** 侧栏半透明：无原生 vibrancy，仅与身后 --background 混合 */
const SIDEBAR_ALPHA = 0.72

function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function channelHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
}

function toHex({ r, g, b }: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function rgbToOklab(rgb: Rgb): Oklab {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function oklabToRgb(lab: Oklab): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

/** OKLab 插值：sRGB 线性插值在深色区会发灰 */
export function mixColors(from: string, to: string, t: number): string {
  const k = Math.min(1, Math.max(0, t))
  const a = rgbToOklab(parseHex(from))
  const b = rgbToOklab(parseHex(to))
  return toHex(
    oklabToRgb({
      L: a.L + (b.L - a.L) * k,
      a: a.a + (b.a - a.a) * k,
      b: a.b + (b.b - a.b) * k,
    }),
  )
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** #rrggbb → 裸 HSL 三元组（shadcn 族的 hsl(var(--x)) 要求） */
export function hexToHslTriplet(hex: string): string {
  const { r, g, b } = parseHex(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = (((g - b) / d) % 6) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
    if (h < 0) h += 360
  }
  return `${round1(h)} ${round1(s * 100)}% ${round1(l * 100)}%`
}

function withAlpha(hex: string, alpha: number): string {
  return `${hex}${channelHex(alpha)}`
}

/** Perceived lightness below the middle: a dark variant. */
export function isDarkSurface(hex: string): boolean {
  return rgbToOklab(parseHex(hex)).L < 0.6
}

function fontStack(name: string | null, base: string): string | null {
  return name ? `'${name}', var(${base})` : null
}

/**
 * 结构化字段 → 全量 CSS 变量表。
 * 系数来自 research §5.3（以 contrast=45 + pi 默认 surface/ink 推出的值 ≈ 现有 light token 标定）。
 * 只产出被推导出的变量：未定制项直接落回 globals.css，注入层不做默认值复读。
 */
export function deriveThemeVariables(variant: ThemeVariant): ThemeVar[] {
  const { accent, surface, ink } = variant
  const k = 0.6 + (Math.min(100, Math.max(0, variant.contrast)) / 100) * 0.8
  const toInk = (t: number) => mixColors(surface, ink, t * k)

  const bg1 = toInk(0.03)
  const bg2 = toInk(0.06)
  const bg3 = toInk(0.1)
  const over = variant.colors ?? {}
  const bgHover = toInk(0.045)
  const bgActive = toInk(0.09)
  const messageUserBg = over.userBubble ?? toInk(0.035)
  const borderLight = over.border ? mixColors(over.border, surface, 0.5) : toInk(0.055)
  const borderBase = over.border ?? toInk(0.11)
  // 侧栏在明暗两侧都比主面暗一档，故朝黑混而非朝 ink 混
  const sidebar = over.sidebar ?? mixColors(surface, '#000000', 0.045)
  const textSecondary = mixColors(ink, surface, 0.38 - 0.1 * (k - 1))
  const textDisabled = mixColors(ink, surface, 0.72 - 0.1 * (k - 1))

  const hex = (name: string, value: string): ThemeVar => ({ name, value, format: 'hex' })
  const hsl = (name: string, from: string): ThemeVar => ({
    name,
    value: hexToHslTriplet(from),
    format: 'hsl-triplet',
  })

  const vars: ThemeVar[] = [
    hex('--bg-base', surface),
    hex('--bg-1', bg1),
    hex('--bg-2', bg2),
    hex('--bg-3', bg3),
    hex('--bg-hover', bgHover),
    hex('--bg-active', bgActive),
    hex('--message-user-bg', messageUserBg),
    hex('--surface-sidebar', variant.translucentSidebar ? withAlpha(sidebar, SIDEBAR_ALPHA) : sidebar),

    hex('--text-primary', ink),
    hex('--text-secondary', textSecondary),
    hex('--text-disabled', textDisabled),

    hex('--border-base', borderBase),
    hex('--border-light', borderLight),

    hex('--brand', accent),
    hex('--brand-hover', mixColors(accent, ink, 0.18)),
    hex('--brand-light', mixColors(accent, surface, 0.88)),
    hex('--focus-border', mixColors(accent, surface, 0.55)),
  ]

  // aou 十阶：surface → accent(第 6 阶) → ink
  for (let i = 1; i <= 10; i++) {
    const value =
      i <= 6
        ? mixColors(surface, accent, 0.08 + (0.92 * (i - 1)) / 5)
        : mixColors(accent, ink, (0.85 * (i - 6)) / 4)
    vars.push(hex(`--aou-${i}`, value))
  }

  if (variant.diffAdded) vars.push(hex('--diff-added', variant.diffAdded))
  if (variant.diffRemoved) vars.push(hex('--diff-removed', variant.diffRemoved))

  if (over.chat) vars.push(hex('--chat-bg', over.chat))
  if (over.codeBg) vars.push(hex('--code-bg', over.codeBg))

  if (variant.fontDisplay) {
    vars.push({ name: '--font-display', value: variant.fontDisplay === 'serif' ? 'var(--font-serif-base)' : `'${variant.fontDisplay}', var(--font-serif-base)`, format: 'raw' })
  }
  if (variant.proseFont === 'display') vars.push({ name: '--prose-font', value: 'var(--font-display)', format: 'raw' })
  if (variant.chatFontSize) vars.push({ name: '--chat-font-size', value: `${variant.chatFontSize}px`, format: 'raw' })
  if (variant.chatLineHeight) vars.push({ name: '--chat-line-height', value: String(variant.chatLineHeight), format: 'raw' })
  if (variant.radius !== undefined) {
    const r = variant.radius
    vars.push(
      { name: '--radius', value: `${r}px`, format: 'raw' },
      { name: '--main-chat-surface-radius', value: `${Math.round(r * 1.6)}px`, format: 'raw' },
      { name: '--composer-shell-radius', value: `${Math.round(r * 1.4)}px`, format: 'raw' },
    )
  }
  if (variant.shadow !== undefined) {
    // 50 = the stock shadows; 0 flat, 100 twice as strong. Dark surfaces need more alpha to read.
    const k = variant.shadow / 50
    const dark = isDarkSurface(surface)
    const top = (dark ? 0.2 : 0.1) * k
    const side = (dark ? 0.28 : 0.14) * k
    const rgb = dark ? '0, 0, 0' : '18, 24, 40'
    vars.push(
      { name: '--main-chat-surface-shadow-top', value: `0 -2px 6px -3px rgba(${rgb}, ${top.toFixed(3)})`, format: 'raw' },
      { name: '--main-chat-surface-shadow', value: `-3px 0 8px -4px rgba(${rgb}, ${side.toFixed(3)}), var(--main-chat-surface-shadow-top)`, format: 'raw' },
    )
  }

  const sans = fontStack(variant.fontUi, '--font-sans-base')
  const mono = fontStack(variant.fontCode, '--font-mono-base')
  if (sans) vars.push({ name: '--font-sans', value: sans, format: 'raw' })
  if (mono) vars.push({ name: '--font-mono', value: mono, format: 'raw' })

  vars.push(
    hsl('--background', surface),
    hsl('--foreground', ink),
    hsl('--card', surface),
    hsl('--card-foreground', ink),
    hsl('--popover', surface),
    hsl('--popover-foreground', ink),
    hsl('--primary', ink),
    hsl('--primary-foreground', surface),
    hsl('--secondary', bg2),
    hsl('--secondary-foreground', ink),
    hsl('--muted', bg2),
    hsl('--muted-foreground', textSecondary),
    hsl('--accent', bgHover),
    hsl('--accent-foreground', ink),
    hsl('--border', borderBase),
    hsl('--input', borderBase),
    hsl('--ring', accent),
    hsl('--surface-0', surface),
    hsl('--surface-1', bg1),
    hsl('--surface-2', bg2),
    hsl('--surface-3', bg3),
    hsl('--text-secondary-hsl', textSecondary),
  )

  return vars
}
