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

export type StreamUpdateSource = 'delta' | 'snapshot'

/**
 * Converts a provider update into a new stream chunk while retaining the
 * cumulative value needed to compare the next update. Providers can emit
 * either token deltas or a growing partial-message snapshot.
 */
export function takeStreamUpdate(
  previous: string,
  update: string,
  source: StreamUpdateSource,
): { chunk: string; cumulative: string } {
  if (!update) return { chunk: '', cumulative: previous }

  if (source === 'delta') {
    return {
      chunk: update,
      cumulative: mergeStreamChunk(previous, update),
    }
  }

  if (!previous) return { chunk: update, cumulative: update }
  if (update === previous) return { chunk: '', cumulative: previous }
  if (update.startsWith(previous)) {
    return {
      chunk: update.slice(previous.length),
      cumulative: update,
    }
  }
  // A stale partial snapshot must not roll the known stream backward.
  if (previous.startsWith(update)) return { chunk: '', cumulative: previous }

  // Some providers replace rather than extend partial snapshots. Preserve the
  // existing downstream merge semantics for that uncommon fallback.
  return {
    chunk: update,
    cumulative: mergeStreamChunk(previous, update),
  }
}