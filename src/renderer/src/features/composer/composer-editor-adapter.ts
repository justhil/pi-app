import { serializeRichInput } from './attachments'
import { caretAllSelected, caretAtEnd, caretAtStart } from './composer-editor-caret'
import type { EditorCursorAdapter } from './use-composer-input-history'

export function makeComposerEditorAdapter(el: HTMLElement): EditorCursorAdapter {
  return {
    getValue: () => serializeRichInput(el).displayText,
    isEmpty: () =>
      !el.textContent?.replace(/\u200B|\s/g, '') && !el.querySelector('[data-attachment-path]'),
    isCaretAtStart: () => caretAtStart(el),
    isCaretAtEnd: () => caretAtEnd(el),
    isAllSelected: () => caretAllSelected(el),
    selectAll: () => {
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    },
  }
}