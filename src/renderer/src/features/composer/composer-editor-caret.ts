export function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  const test = document.createRange()
  test.selectNodeContents(el)
  test.collapse(true)
  return range.collapsed && range.compareBoundaryPoints(Range.START_TO_START, test) <= 0
}

export function caretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  const test = document.createRange()
  test.selectNodeContents(el)
  test.collapse(false)
  return range.collapsed && range.compareBoundaryPoints(Range.END_TO_END, test) >= 0
}

export function caretAllSelected(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false
  const full = document.createRange()
  full.selectNodeContents(el)
  return (
    range.compareBoundaryPoints(Range.START_TO_START, full) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, full) >= 0
  )
}

export function insertTextAtCursor(el: HTMLElement, text: string) {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0)
  else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  // Record the insertion anchor: normalize merges/removes the inserted text node, so capture
  // the original position first and derive the caret from it.
  const anchorIsText = range.startContainer.nodeType === Node.TEXT_NODE
  const anchorNode = range.startContainer
  const anchorOffset = range.startOffset
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  const prev = node.previousSibling
  // Normalize before placing the caret so the selection never references merged/removed nodes.
  el.normalize()
  if (sel) {
    const caretRange = document.createRange()
    if (anchorIsText && anchorNode.parentNode) {
      // Caret was inside a text node with offset > 0: that node keeps the full merged text
      // after normalize; caret = original offset + inserted text length.
      caretRange.setStart(anchorNode, anchorOffset + text.length)
      caretRange.setEnd(anchorNode, anchorOffset + text.length)
    } else if (anchorIsText && node.parentNode) {
      // Caret was at the start of a text node (offset 0): the original node was removed by
      // normalize, the inserted node survives; caret = inserted text length.
      caretRange.setStart(node, text.length)
      caretRange.setEnd(node, text.length)
    } else if (prev && prev.parentNode && prev.nodeType === Node.TEXT_NODE) {
      // Insert at an element boundary with a preceding text node: the new text merges into it;
      // caret sits at its end.
      const prevText = prev as Text
      caretRange.setStart(prevText, prevText.length)
      caretRange.setEnd(prevText, prevText.length)
    } else if (node.parentNode) {
      // Insert at an element boundary with no preceding text: the inserted node survives (it may
      // absorb following text); caret sits right after the inserted text.
      caretRange.setStart(node, text.length)
      caretRange.setEnd(node, text.length)
    } else {
      caretRange.selectNodeContents(el)
      caretRange.collapse(false)
    }
    sel.removeAllRanges()
    sel.addRange(caretRange)
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}