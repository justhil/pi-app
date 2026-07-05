import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../sanitize'

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeHtml('<script>alert(1)</script><p>hello</p>')
    expect(result).toContain('hello')
    expect(result).not.toContain('script')
  })

  it('strips event handlers', () => {
    const result = sanitizeHtml('<img src=x onerror=alert(1) alt="test" />')
    expect(result).not.toContain('onerror')
  })

  it('preserves safe content', () => {
    const result = sanitizeHtml('<span class="katex">math</span>')
    expect(result).toContain('katex')
    expect(result).toContain('math')
  })

  it('preserves math tags', () => {
    const result = sanitizeHtml('<math><mi>x</mi></math>')
    expect(result).toContain('math')
    expect(result).toContain('mi')
  })
})
