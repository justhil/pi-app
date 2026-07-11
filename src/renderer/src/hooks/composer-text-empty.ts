/**
 * Composer empty detection for double-Esc tree/fork.
 * Uses contenteditable `.rich-input` under `[data-composer-root]` (not textarea).
 */

/** Pure: is a rich-input element's content empty (ZWSP/whitespace-only count as empty). */
export function isRichInputElementEmpty(element: HTMLElement | null | undefined): boolean {
  if (!element) return true
  if (element.querySelector('[data-attachment-path], [data-attachment-chip-id], .rich-attachment-chip')) {
    return false
  }
  const text = collectVisibleText(element).replace(/\u200B/g, '').trim()
  return text.length === 0
}

function collectVisibleText(node: Node): string {
  let text = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue || ''
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const element = child as HTMLElement
    if (
      element.dataset.attachmentPath != null ||
      element.dataset.attachmentChipId != null ||
      element.classList.contains('rich-attachment-chip')
    ) {
      return
    }
    if (element.tagName === 'BR') return
    text += collectVisibleText(child)
  })
  return text
}

/**
 * Whether the composer has no draft text and no attachment chips.
 * Attachment chips under the composer root (strip or inside rich-input) count as non-empty.
 */
export function composerTextEmpty(root: ParentNode | Document | null = typeof document !== 'undefined' ? document : null): boolean {
  if (!root) return true
  const composerRoot = root.querySelector?.('[data-composer-root]') as HTMLElement | null
  const scope: ParentNode = composerRoot ?? root

  if (scope.querySelector?.('[data-attachment-path], [data-attachment-chip-id], .rich-attachment-chip')) {
    return false
  }

  const richInput = scope.querySelector?.('.rich-input') as HTMLElement | null
  if (richInput) return isRichInputElementEmpty(richInput)

  // Legacy fallback: plain textarea (tests / older shells)
  const textarea = scope.querySelector?.('textarea') as HTMLTextAreaElement | null
  if (textarea) return !textarea.value.replace(/\u200B/g, '').trim()

  return true
}
