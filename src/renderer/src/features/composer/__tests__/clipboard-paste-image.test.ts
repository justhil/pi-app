import { describe, it, expect } from 'vitest'
import {
  extractDataUrlImageFromHtml,
  isMeaningfulPlainPaste,
  normalizeClipboardImageMime,
  plainTextFromClipboardHtml,
} from '../clipboard-paste-image'

describe('clipboard-paste-image', () => {
  it('extracts embedded data URL image from html paste', () => {
    const html = '<meta><img src="data:image/png;base64,iVBORw0KGgo=" />'
    const r = extractDataUrlImageFromHtml(html)
    expect(r?.mimeType).toBe('image/png')
    expect(r?.base64).toBe('iVBORw0KGgo=')
  })

  it('returns null when html has no image', () => {
    expect(extractDataUrlImageFromHtml('<p>hello</p>')).toBeNull()
  })

  it('strips html to plain text', () => {
    expect(plainTextFromClipboardHtml('<p><b>hi</b></p>').trim()).toBe('hi')
  })

  it('ignores whitespace-only plain when pasting images', () => {
    expect(isMeaningfulPlainPaste('   ')).toBe(false)
    expect(isMeaningfulPlainPaste('\u200B')).toBe(false)
    expect(isMeaningfulPlainPaste('hi')).toBe(true)
  })

  it('normalizes clipboard image mime for IPC schema', () => {
    expect(normalizeClipboardImageMime('image/png')).toBe('image/png')
    expect(normalizeClipboardImageMime('image/jpeg; charset=binary')).toBe('image/jpeg')
    expect(normalizeClipboardImageMime('image/heic')).toBeNull()
  })
})