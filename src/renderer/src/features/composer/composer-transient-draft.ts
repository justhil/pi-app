import { viewSessionKeyOf, type ViewKeyInput } from '@renderer/stores/session-state'
import type { Segment, StagedImage } from './attachments'

export type ComposerDraftContext = ViewKeyInput

/** Unsent composer text per session; keyed exactly like `sessionStates` (session file or draft). */
const transientDrafts = new Map<string, Segment[]>()
/** Unsent staged images per session, same keying (images live outside the editor). */
const transientImages = new Map<string, StagedImage[]>()

export function composerDraftContextKey(context: ComposerDraftContext): string {
  return viewSessionKeyOf(context)
}

export function rememberTransientComposerDraft(contextKey: string, segments: Segment[]): void {
  if (segments.length === 0) {
    transientDrafts.delete(contextKey)
    return
  }
  transientDrafts.set(contextKey, segments)
}

export function readTransientComposerDraft(contextKey: string): Segment[] | null {
  return transientDrafts.get(contextKey) ?? null
}

export function clearTransientComposerDraft(contextKey: string): void {
  transientDrafts.delete(contextKey)
  transientImages.delete(contextKey)
}

export function rememberTransientComposerImages(contextKey: string, images: StagedImage[]): void {
  if (images.length === 0) {
    transientImages.delete(contextKey)
    return
  }
  transientImages.set(contextKey, images)
}

export function readTransientComposerImages(contextKey: string): StagedImage[] | null {
  return transientImages.get(contextKey) ?? null
}
