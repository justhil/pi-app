import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { composerTextEmpty, isRichInputElementEmpty } from '../composer-text-empty'

describe('composerTextEmpty / isRichInputElementEmpty', () => {
  let root: HTMLDivElement

  beforeEach(() => {
    root = document.createElement('div')
    root.setAttribute('data-composer-root', '')
    document.body.appendChild(root)
  })

  afterEach(() => {
    root.remove()
  })

  function mountRich(html: string): HTMLElement {
    const rich = document.createElement('div')
    rich.className = 'rich-input'
    rich.contentEditable = 'true'
    rich.innerHTML = html
    root.appendChild(rich)
    return rich
  }

  it('treats missing composer as empty', () => {
    root.remove()
    expect(composerTextEmpty(document)).toBe(true)
  })

  it('treats empty rich-input as empty', () => {
    mountRich('')
    expect(composerTextEmpty()).toBe(true)
  })

  it('treats ZWSP-only as empty', () => {
    const rich = mountRich('\u200B')
    expect(isRichInputElementEmpty(rich)).toBe(true)
    expect(composerTextEmpty()).toBe(true)
  })

  it('treats whitespace-only as empty', () => {
    mountRich('   \n\t  ')
    expect(composerTextEmpty()).toBe(true)
  })

  it('treats real text as non-empty', () => {
    mountRich('hello')
    expect(composerTextEmpty()).toBe(false)
  })

  it('treats text with ZWSP as non-empty when other chars exist', () => {
    mountRich('\u200Bhi\u200B')
    expect(composerTextEmpty()).toBe(false)
  })

  it('treats attachment chip inside rich-input as non-empty', () => {
    const rich = mountRich('')
    const chip = document.createElement('span')
    chip.className = 'rich-attachment-chip'
    chip.dataset.attachmentPath = '/tmp/a.png'
    rich.appendChild(chip)
    expect(isRichInputElementEmpty(rich)).toBe(false)
    expect(composerTextEmpty()).toBe(false)
  })

  it('treats attachment strip under composer root as non-empty', () => {
    mountRich('')
    const strip = document.createElement('div')
    strip.className = 'composer-attachments-strip'
    const chip = document.createElement('span')
    chip.dataset.attachmentPath = '/tmp/b.txt'
    strip.appendChild(chip)
    root.appendChild(strip)
    expect(composerTextEmpty()).toBe(false)
  })

  it('falls back to textarea value when no rich-input', () => {
    const ta = document.createElement('textarea')
    ta.value = '  '
    root.appendChild(ta)
    expect(composerTextEmpty()).toBe(true)
    ta.value = 'x'
    expect(composerTextEmpty()).toBe(false)
  })
})
