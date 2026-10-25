/**
 * One preview at a time, owned outside the component that opened it: a timeline row re-renders
 * while a turn streams, and a lightbox held in that row's state would close under the user.
 */
export type ImagePreview = { src: string; alt?: string }

let current: ImagePreview | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function openImagePreview(src: string, alt?: string): void {
  current = { src, alt }
  emit()
}

export function closeImagePreview(): void {
  if (!current) return
  current = null
  emit()
}

export function getImagePreview(): ImagePreview | null {
  return current
}

export function subscribeImagePreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
