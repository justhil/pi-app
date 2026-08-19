import { afterEach, describe, expect, it } from 'vitest'
import { insertAttachmentAtCursor, serializeRichInput, type Segment } from '../attachments'

function setupEditor(html: string): HTMLElement {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function texts(segments: Segment[]): string {
  return segments
    .map((s) => {
      if (s.type === 'text') return s.text
      if (s.type === 'file') return `[chip:${s.attachment.name}]`
      return `[chip:${s.name}]`
    })
    .join('|')
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('serializeRichInput block boundaries (rich-text paste)', () => {
  it('turns div boundaries into newlines', () => {
    const el = setupEditor('<div>line1</div><div>line2</div>')
    expect(serializeRichInput(el).displayText).toBe('line1\nline2')
  })

  it('does not add leading newlines for a leading block', () => {
    const el = setupEditor('<div>a</div><div>b</div><div>c</div>')
    expect(serializeRichInput(el).displayText).toBe('a\nb\nc')
  })

  it('keeps br newlines inside blocks without doubling', () => {
    const el = setupEditor('<div>a<br>b</div><div>c</div>')
    expect(serializeRichInput(el).displayText).toBe('a\nb\nc')
  })

  it('handles nested blocks with a single newline', () => {
    const el = setupEditor('<div><div>a</div><div>b</div></div><div>c</div>')
    expect(serializeRichInput(el).displayText).toBe('a\nb\nc')
  })

  it('treats p/li/blockquote as block breaks', () => {
    const el = setupEditor('<p>one</p><p>two</p><ul><li>x</li><li>y</li></ul>')
    expect(serializeRichInput(el).displayText).toBe('one\ntwo\nx\ny')
  })

  it('ignores inline wrappers (span/b/i) as newlines', () => {
    const el = setupEditor('<span>a</span><b>b</b><i>c</i>')
    expect(serializeRichInput(el).displayText).toBe('abc')
  })

  it('separates blocks after a bare text node', () => {
    const el = setupEditor('text<div>b</div>')
    expect(serializeRichInput(el).displayText).toBe('text\nb')
  })

  it('keeps chip segments when blocks surround them', () => {
    const el = setupEditor(
      '<div>a</div>\u200B<span contenteditable="false" data-attachment-path="C:/x.ts" data-attachment-name="x.ts" data-attachment-kind="code"></span>\u200B<div>b</div>',
    )
    const result = serializeRichInput(el)
    // chip 是分段边界：块分隔符只在前一段文本非空时补齐，chip 两侧的换行不跨段合成。
    expect(texts(result.segments)).toBe('a|[chip:x.ts]|b')
    expect(result.displayText).toBe('ab')
  })
})

describe('insertAttachmentAtCursor', () => {
  it('inserts the chip with ZWSP anchors and places the caret after it (jsdom fallback path)', () => {
    const el = setupEditor('hi')
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(range)

    insertAttachmentAtCursor(el, { path: 'C:/x.ts', name: 'x.ts', kind: 'code' })

    const chip = el.querySelector('.rich-attachment-chip')
    expect(chip).toBeTruthy()
    expect(el.textContent).toBe('hi\u200Bx.ts\u200B')
    // 前缀 ZWSP 与前文合并，后缀 ZWSP 保留在 chip 之后 → 光标在其 offset 1 处。
    const caretRange = sel?.getRangeAt(0)
    expect(caretRange?.startContainer.nodeType).toBe(Node.TEXT_NODE)
    expect((caretRange?.startContainer as Text).textContent).toBe('\u200B')
    expect(caretRange?.startOffset).toBe(1)
  })

  it('replaces an existing selection with the chip', () => {
    const el = setupEditor('hello')
    const sel = window.getSelection()
    const range = document.createRange()
    const textNode = el.firstChild as Text
    range.setStart(textNode, 1)
    range.setEnd(textNode, 4)
    sel?.removeAllRanges()
    sel?.addRange(range)

    insertAttachmentAtCursor(el, { path: 'C:/x.ts', name: 'x.ts', kind: 'code' })

    expect(el.textContent).toBe('h\u200Bx.ts\u200Bo')
    expect(el.querySelectorAll('.rich-attachment-chip').length).toBe(1)
  })
})
