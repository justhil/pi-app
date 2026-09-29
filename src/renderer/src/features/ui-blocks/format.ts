const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const fullFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function formatCompact(value: number): string {
  return Math.abs(value) >= 100_000 ? compactFormatter.format(value) : fullFormatter.format(value)
}

export function formatFull(value: number, unit?: string): string {
  const text = fullFormatter.format(value)
  if (!unit) return text
  return unit === '%' ? `${text}%` : `${text} ${unit}`
}

export type Trend = 'up' | 'down' | 'flat'

/** Explicit trend wins; otherwise read the sign of the delta text. */
export function resolveTrend(trend: Trend | undefined, delta: string | undefined): Trend | undefined {
  if (trend) return trend
  const text = (delta || '').trim()
  if (!text) return undefined
  if (/^[+↑▲]/.test(text)) return 'up'
  if (/^[-−↓▼]/.test(text)) return 'down'
  return 'flat'
}

/** Series colour tokens (light/dark defined in ui-blocks.css). */
export function seriesColor(index: number): string {
  return `var(--uib-c${(index % 8) + 1})`
}
