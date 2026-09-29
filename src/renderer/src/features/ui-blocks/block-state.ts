import { useCallback, useRef, useState } from 'react'

/**
 * Interaction state (sort, page, quiz answers, tree position…) keyed by block identity. A block
 * remounts when a streamed answer moves it from the live tail into the settled prefix and again
 * when the final render replaces the streaming one; a module store keeps what the user did.
 */
const MAX_ENTRIES = 300
const store = new Map<string, unknown>()

function remember(key: string, value: unknown): void {
  store.delete(key)
  store.set(key, value)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
}

export function useBlockState<T>(
  blockKey: string,
  slot: string,
  initial: T | (() => T),
): [T, (next: T | ((previous: T) => T)) => void] {
  const key = `${blockKey}::${slot}`
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial,
  )
  const keyRef = useRef(key)
  keyRef.current = key
  const update = useCallback((next: T | ((previous: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      remember(keyRef.current, resolved)
      return resolved
    })
  }, [])
  return [value, update]
}

/** blockKey → time the block first appeared live (-1: first seen settled, never animates). */
const firstSeen = new Map<string, number>()
const ENTRY_WINDOW_MS = 1400

export type EntryAnimation = { animate: boolean; elapsed: number }

/**
 * Entry animation plays when a block first completes during a live answer; history renders still.
 * A streamed block remounts right after it completes (live tail → settled prefix → final render),
 * so a remount inside the entry window resumes the animation `elapsed` ms in (negative CSS delay)
 * instead of restarting it or cutting it off.
 */
export function claimEntryAnimation(blockKey: string, streaming: boolean, now = performance.now()): EntryAnimation {
  const first = firstSeen.get(blockKey)
  if (first === undefined) {
    firstSeen.set(blockKey, streaming ? now : -1)
    if (firstSeen.size > MAX_ENTRIES * 2) {
      const oldest = firstSeen.keys().next().value
      if (oldest !== undefined) firstSeen.delete(oldest)
    }
    return { animate: streaming, elapsed: 0 }
  }
  if (first < 0) return { animate: false, elapsed: 0 }
  const elapsed = now - first
  return elapsed < ENTRY_WINDOW_MS ? { animate: true, elapsed } : { animate: false, elapsed: 0 }
}

/** FNV-1a over the raw fence body: stable, cheap identity for a block's content. */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function clearBlockStateForTests(): void {
  store.clear()
  firstSeen.clear()
}
