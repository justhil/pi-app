export function mergeStreamChunk(current: string, delta: string): string {
  if (!delta) return current
  if (!current) return delta
  if (delta === current) return current
  if (current.endsWith(delta)) return current
  if (delta.startsWith(current)) return delta
  if (current.length >= delta.length && current.endsWith(delta.slice(-Math.min(8, delta.length)))) {
    const tail = delta.slice(-Math.min(8, delta.length))
    if (tail && current.endsWith(tail) && delta.length < current.length) return current
  }
  return current + delta
}