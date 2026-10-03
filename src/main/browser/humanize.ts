/** Human-like input timing and pointer paths (pure; seedable for tests). */

export type Rng = () => number

/** Small deterministic PRNG (mulberry32) for reproducible tests; production uses Math.random. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a)

export interface PathPoint {
  x: number
  y: number
  /** Delay before this point, ms. */
  delay: number
}

/**
 * Cubic Bézier path from `from` to `to` with randomized control points, more steps for longer
 * moves and an ease-out so the pointer slows down on arrival. Ends exactly on `to`.
 */
export function pointerPath(from: { x: number; y: number }, to: { x: number; y: number }, rng: Rng = Math.random): PathPoint[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  if (dist < 2) return [{ x: Math.round(to.x), y: Math.round(to.y), delay: 0 }]
  const steps = Math.max(6, Math.min(40, Math.round(dist / 18 + between(rng, 4, 10))))
  const spread = Math.min(120, dist * 0.35)
  const c1 = { x: from.x + (to.x - from.x) * between(rng, 0.2, 0.4) + between(rng, -spread, spread), y: from.y + (to.y - from.y) * between(rng, 0.1, 0.3) + between(rng, -spread, spread) }
  const c2 = { x: from.x + (to.x - from.x) * between(rng, 0.6, 0.85) + between(rng, -spread / 2, spread / 2), y: from.y + (to.y - from.y) * between(rng, 0.7, 0.9) + between(rng, -spread / 2, spread / 2) }
  const out: PathPoint[] = []
  for (let i = 1; i <= steps; i++) {
    const t = 1 - Math.pow(1 - i / steps, 2.2)
    const u = 1 - t
    const x = u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x
    const y = u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y
    out.push({ x: Math.round(x), y: Math.round(y), delay: Math.round(between(rng, 5, 16)) })
  }
  out[out.length - 1] = { x: Math.round(to.x), y: Math.round(to.y), delay: out[out.length - 1].delay }
  return out
}

/** A point inside the target, biased to its middle (people rarely click the exact center or edge). */
export function clickPoint(rect: { x: number; y: number; width: number; height: number }, rng: Rng = Math.random) {
  const jx = rect.width > 8 ? between(rng, -0.22, 0.22) * rect.width : 0
  const jy = rect.height > 8 ? between(rng, -0.22, 0.22) * rect.height : 0
  return { x: Math.round(rect.x + rect.width / 2 + jx), y: Math.round(rect.y + rect.height / 2 + jy) }
}

/** Typing as chunks (1–3 chars) with human-ish gaps; longer pauses after spaces/punctuation. */
export function typingChunks(text: string, rng: Rng = Math.random): { text: string; delay: number }[] {
  const out: { text: string; delay: number }[] = []
  const chars = [...text]
  for (let i = 0; i < chars.length; ) {
    const n = Math.min(chars.length - i, 1 + Math.floor(rng() * 3))
    const chunk = chars.slice(i, i + n).join('')
    i += n
    const pause = /[\s,.;:!?，。；：！？]$/.test(chunk) ? between(rng, 90, 220) : between(rng, 35, 120)
    out.push({ text: chunk, delay: Math.round(pause) })
  }
  return out
}
