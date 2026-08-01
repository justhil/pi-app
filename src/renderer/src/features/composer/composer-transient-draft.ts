import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import type { Segment } from './attachments'

export type ComposerDraftContext = {
  currentWorkspace: string | null
  currentSessionId: string | null
  historySessionFile: string | null
  ephemeralSandboxDraft: boolean
  pendingNewSessionPlaceholder: boolean
}

const transientDrafts = new Map<string, Segment[]>()

export function composerDraftContextKey(context: ComposerDraftContext): string {
  if (context.ephemeralSandboxDraft) return 'ephemeral'
  if (context.pendingNewSessionPlaceholder) {
    return `pending:${context.currentWorkspace || ''}`
  }
  const sessionFile = normalizeSessionFileKey(context.historySessionFile)
  if (sessionFile) return `file:${sessionFile}`
  if (context.currentSessionId) {
    return `session:${context.currentWorkspace || ''}:${context.currentSessionId}`
  }
  return `workspace:${context.currentWorkspace || ''}`
}

export function rememberTransientComposerDraft(contextKey: string, segments: Segment[]): void {
  if (segments.length === 0) {
    clearTransientComposerDraft(contextKey)
    return
  }
  transientDrafts.set(contextKey, segments)
}

export function readTransientComposerDraft(contextKey: string): Segment[] | null {
  return transientDrafts.get(contextKey) ?? null
}

export function clearTransientComposerDraft(contextKey: string): void {
  transientDrafts.delete(contextKey)
}
