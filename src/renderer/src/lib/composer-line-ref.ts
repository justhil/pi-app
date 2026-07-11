/**
 * Insert a path:line reference as an attachment-style chip into the composer
 * (same UX as file / image chips — not plain text).
 */

import { useUIStore } from '@renderer/stores/ui-store'
import {
  insertAttachmentAtCursor,
  type AttachmentMeta,
} from '@renderer/features/composer/attachments'

export type LineRefInput = {
  path: string
  line: number
  endLine?: number
  content?: string
}

function normalizePathForRef(path: string): string {
  const store = useUIStore.getState()
  let raw = path.replace(/\\/g, '/').trim()
  const root = store.currentWorkspace?.replace(/\\/g, '/').replace(/\/$/, '')
  if (root && raw.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    raw = raw.slice(root.length + 1)
  }
  return raw
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/** Build AttachmentMeta used by the rich-input chip system. */
export function lineRefToAttachmentMeta(input: LineRefInput): AttachmentMeta {
  const path = normalizePathForRef(input.path)
  const linePart =
    input.endLine != null && input.endLine !== input.line
      ? `${input.line}-${input.endLine}`
      : String(input.line)
  const snippet = (input.content || '').replace(/\s+/g, ' ').trim()
  return {
    path,
    name: `${basename(path)}:${linePart}`,
    kind: 'line-ref',
    line: input.line,
    endLine: input.endLine,
    snippet: snippet ? (snippet.length > 100 ? `${snippet.slice(0, 100)}…` : snippet) : undefined,
    chipId: `line-ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

/** @deprecated use lineRefToAttachmentMeta + chip insert; kept for tests */
export function formatLineRef(input: LineRefInput): string {
  const meta = lineRefToAttachmentMeta(input)
  const linePart =
    meta.endLine != null && meta.endLine !== meta.line
      ? `${meta.line}-${meta.endLine}`
      : String(meta.line)
  return meta.snippet ? `${meta.path}:${linePart}\n  ${meta.snippet}` : `${meta.path}:${linePart}`
}

export function focusComposerInput(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-composer-root] .rich-input') as HTMLElement | null
    el?.focus()
  })
}

/**
 * Insert line-ref chip into the composer at the caret (appends at end if no selection).
 * Same pattern as attaching a file/image.
 */
export function queueComposerLineRefAndFocus(input: LineRefInput): void {
  if (!input.path || !Number.isFinite(input.line) || input.line < 1) return
  const el = document.querySelector('[data-composer-root] .rich-input') as HTMLElement | null
  if (!el) {
    // Fallback: plain text append if composer not mounted
    useUIStore.getState().appendComposerPrefill(formatLineRef(input))
    return
  }
  const meta = lineRefToAttachmentMeta(input)
  insertAttachmentAtCursor(el, meta)
  focusComposerInput()
}
