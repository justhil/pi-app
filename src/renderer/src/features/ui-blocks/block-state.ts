import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Interaction state (sort, page, quiz answers, live panel overrides…) keyed by block identity.
 * Shared across mounts and synchronized between Timeline inline blocks and the Canvas side stage.
 */
const MAX_ENTRIES = 300
const store = new Map<string, unknown>()
const listeners = new Map<string, Set<(value: unknown) => void>>()

function notify(key: string, value: unknown): void {
  const subs = listeners.get(key)
  if (!subs) return
  for (const cb of subs) cb(value)
}

function remember(key: string, value: unknown): void {
  store.delete(key)
  store.set(key, value)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  notify(key, value)
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

  useEffect(() => {
    let subs = listeners.get(key)
    if (!subs) {
      subs = new Set()
      listeners.set(key, subs)
    }
    const handler = (incoming: unknown) => {
      setValue((prev) => (Object.is(prev, incoming) ? prev : (incoming as T)))
    }
    subs.add(handler)
    return () => {
      subs?.delete(handler)
      if (subs && subs.size === 0) listeners.delete(key)
    }
  }, [key])

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
  listeners.clear()
}
