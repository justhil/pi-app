/** Index of the usable stop nearest to `fraction` (0..1 along the track); -1 when none usable. */
export function nearestUsableStop(fraction: number, count: number, usable: readonly boolean[]): number {
  if (count <= 1) return usable[0] ? 0 : -1
  const raw = Math.max(0, Math.min(1, fraction)) * (count - 1)
  let best = -1
  for (let i = 0; i < count; i++) {
    if (!usable[i]) continue
    if (best === -1 || Math.abs(i - raw) < Math.abs(best - raw)) best = i
  }
  return best
}

/** Next usable stop in `dir` (-1 / +1) from `from`, staying put at the ends. */
export function stepUsableStop(from: number, dir: -1 | 1, usable: readonly boolean[]): number {
  for (let i = from + dir; i >= 0 && i < usable.length; i += dir) if (usable[i]) return i
  return from
}
