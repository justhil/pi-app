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

export function insertBrAtCursor(el: HTMLElement) {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0)
  else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  range.deleteContents()
  const br = document.createElement('br')
  const after = document.createTextNode('\u200B')
  range.insertNode(br)
  range.setStartAfter(br)
  range.setEndAfter(br)
  range.insertNode(after)
  range.setStartAfter(after)
  range.setEndAfter(after)
  sel?.removeAllRanges()
  sel?.addRange(range)
  el.normalize()
  el.dispatchEvent(new Event('input', { bubbles: true }))
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
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  sel?.removeAllRanges()
  sel?.addRange(range)
  el.normalize()
  el.dispatchEvent(new Event('input', { bubbles: true }))
}