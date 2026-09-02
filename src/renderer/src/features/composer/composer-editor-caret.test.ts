import { afterEach, describe, expect, it } from 'vitest'
import { anchorLineBreakCaret, insertTextAtCursor } from './composer-editor-caret'

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

describe('anchorLineBreakCaret', () => {
  it('adds a ZWSP anchor after every lone <br>', () => {
    const el = setupEditor('ab<br>cd<br>ef')

    anchorLineBreakCaret(el)

    const brs = el.querySelectorAll('br')
    expect(brs.length).toBe(2)
    for (const br of brs) {
      const next = br.nextSibling
      expect(next?.nodeType).toBe(Node.TEXT_NODE)
      expect((next as Text).nodeValue?.startsWith('\u200B')).toBe(true)
    }
  })

  it('skips <br>s that already carry a ZWSP anchor', () => {
    const el = setupEditor('ab<br>\u200Bcd')

    anchorLineBreakCaret(el)

    expect(el.querySelectorAll('br').length).toBe(1)
    // 不重复插入：br 后仍只有一个文本节点。
    const next = el.querySelector('br')?.nextSibling
    expect(next?.nodeType).toBe(Node.TEXT_NODE)
    expect((next as Text).nodeValue).toBe('\u200Bcd')
  })

  it('handles a trailing <br> (empty last line)', () => {
    const el = setupEditor('ab<br>')

    anchorLineBreakCaret(el)

    const next = el.querySelector('br')?.nextSibling
    expect(next?.nodeType).toBe(Node.TEXT_NODE)
    expect((next as Text).nodeValue).toBe('\u200B')
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
