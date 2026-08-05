import { afterEach, describe, expect, it } from 'vitest'
import { insertBrAtCursor, insertTextAtCursor } from './composer-editor-caret'

function setupEditor(html: string): HTMLElement {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function placeCaretAtOffset(el: HTMLElement, offset: number) {
  const textNode = el.firstChild as Text
  const range = document.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function caret(): Range {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) throw new Error('no selection')
  return sel.getRangeAt(0)
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('insertBrAtCursor', () => {
  it('appends a line break at the end and keeps the caret after it', () => {
    const el = setupEditor('hello')
    placeCaretAtEnd(el)

    insertBrAtCursor(el)

    expect(el.textContent).toBe('hello\u200B')
    expect(el.querySelectorAll('br').length).toBe(1)
    const range = caret()
    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE)
    expect((range.startContainer as Text).textContent).toBe('\u200B')
    expect(range.startOffset).toBe(1)
  })

  it('inserts a line break in the middle of text and keeps the caret after the break', () => {
    const el = setupEditor('abcd')
    placeCaretAtOffset(el, 2)

    insertBrAtCursor(el)

    // The ZWSP merges with the following text into "\u200Bcd"; the caret must land at offset 1
    // (right after the ZWSP) instead of being lost.
    expect(el.textContent).toBe('ab\u200Bcd')
    expect(el.querySelectorAll('br').length).toBe(1)
    const range = caret()
    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE)
    expect((range.startContainer as Text).textContent).toBe('\u200Bcd')
    expect(range.startOffset).toBe(1)
  })

  it('handles an empty editor', () => {
    const el = setupEditor('')
    placeCaretAtEnd(el)

    insertBrAtCursor(el)

    expect(el.textContent).toBe('\u200B')
    const range = caret()
    expect(range.startContainer).toBe(el.lastChild)
    expect(range.startOffset).toBe(1)
  })
})

describe('insertTextAtCursor', () => {
  it('appends text at the end and keeps the caret after it', () => {
    const el = setupEditor('hello')
    placeCaretAtEnd(el)

    insertTextAtCursor(el, ' world')

    expect(el.textContent).toBe('hello world')
    const range = caret()
    expect(range.startContainer).toBe(el.firstChild)
    expect(range.startOffset).toBe(11)
  })

  it('inserts text in the middle of a text node', () => {
    const el = setupEditor('abcd')
    placeCaretAtOffset(el, 2)

    insertTextAtCursor(el, 'XY')

    expect(el.textContent).toBe('abXYcd')
    const range = caret()
    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE)
    expect((range.startContainer as Text).textContent).toBe('abXYcd')
    expect(range.startOffset).toBe(4)
  })

  it('inserts text at the start of a text node (offset 0)', () => {
    const el = setupEditor('abcd')
    placeCaretAtOffset(el, 0)

    insertTextAtCursor(el, 'XY')

    expect(el.textContent).toBe('XYabcd')
    const range = caret()
    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE)
    expect((range.startContainer as Text).textContent).toBe('XYabcd')
    expect(range.startOffset).toBe(2)
  })

  it('replaces a selection and keeps the caret after the inserted text', () => {
    const el = setupEditor('abcdef')
    const textNode = el.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 2)
    range.setEnd(textNode, 4)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)

    insertTextAtCursor(el, 'XY')

    expect(el.textContent).toBe('abXYef')
    const caretRange = caret()
    expect((caretRange.startContainer as Text).textContent).toBe('abXYef')
    expect(caretRange.startOffset).toBe(4)
  })
})
