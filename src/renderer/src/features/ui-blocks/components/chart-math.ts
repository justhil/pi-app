/** Pure geometry helpers for the SVG chart (unit-tested separately from rendering). */

export type NiceScale = { min: number; max: number; ticks: number[] }

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(rawStep))
  const base = 10 ** exponent
  const fraction = rawStep / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * base
}

/** Round a [min, max] extent out to readable tick values (≈ `count` ticks). */
export function niceScale(min: number, max: number, count = 5): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1
    min -= pad
    max += pad
  }
  const step = niceStep((max - min) / Math.max(1, count))
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = niceMin; value <= niceMax + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
  }
  return { min: niceMin, max: niceMax, ticks }
}

/** Extent of a set of series, optionally stacked (positive and negative parts stack apart). */
export function seriesExtent(
  series: Array<Array<number | null>>,
  stacked: boolean,
  includeZero: boolean,
): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  if (stacked) {
    const length = Math.max(0, ...series.map((data) => data.length))
    for (let index = 0; index < length; index += 1) {
      let positive = 0
      let negative = 0
      for (const data of series) {
        const value = data[index]
        if (value == null) continue
        if (value >= 0) positive += value
        else negative += value
      }
      max = Math.max(max, positive)
      min = Math.min(min, negative)
    }
  } else {
    for (const data of series) {
      for (const value of data) {
        if (value == null) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (includeZero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  return [min, max]
}

/**
 * Stack offsets per series/category: returns [start, end] for each value, stacking positive values
 * upward and negative values downward from zero.
 */
export function stackSeries(series: Array<Array<number | null>>): Array<Array<[number, number] | null>> {
  const length = Math.max(0, ...series.map((data) => data.length))
  const positive = new Array<number>(length).fill(0)
  const negative = new Array<number>(length).fill(0)
  return series.map((data) =>
    Array.from({ length }, (_, index) => {
      const value = data[index]
      if (value == null) return null
      if (value >= 0) {
        const start = positive[index]
        positive[index] += value
        return [start, positive[index]] as [number, number]
      }
      const start = negative[index]
      negative[index] += value
      return [start, negative[index]] as [number, number]
    }),
  )
}

/** Show every `step`-th category label so labels never collide at the current width. */
export function labelStep(labels: string[], plotWidth: number, charWidth = 6.5): number {
  if (labels.length === 0) return 1
  const widest = Math.max(...labels.map((label) => Math.max(24, label.length * charWidth)))
  const fit = Math.max(1, Math.floor(plotWidth / (widest + 10)))
  return Math.max(1, Math.ceil(labels.length / fit))
}

export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

/** SVG arc path for a pie/donut slice (angles in radians, 0 = 12 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-6)
  const large = sweep > Math.PI ? 1 : 0
  const point = (radius: number, angle: number) =>
    `${(cx + radius * Math.sin(angle)).toFixed(2)},${(cy - radius * Math.cos(angle)).toFixed(2)}`
  const endAngle = start + sweep
  if (inner <= 0) {
    return `M${cx},${cy} L${point(outer, start)} A${outer},${outer} 0 ${large} 1 ${point(outer, endAngle)} Z`
  }
  return [
    `M${point(outer, start)}`,
    `A${outer},${outer} 0 ${large} 1 ${point(outer, endAngle)}`,
    `L${point(inner, endAngle)}`,
    `A${inner},${inner} 0 ${large} 0 ${point(inner, start)}`,
    'Z',
  ].join(' ')
}
