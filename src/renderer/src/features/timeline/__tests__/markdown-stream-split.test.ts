import { describe, expect, it } from 'vitest'
import { splitStreamingMarkdown } from '../markdown-stream-split'

describe('splitStreamingMarkdown', () => {
  it('keeps short stream as single tail', () => {
    expect(splitStreamingMarkdown('hello')).toEqual({ committed: '', tail: 'hello' })
  })

  it('splits at paragraph boundary', () => {
    const text = 'First paragraph line.\n\nSecond paragraph still typing here'
    const out = splitStreamingMarkdown(text)
    expect(out.committed).toBe('First paragraph line.\n\n')
    expect(out.tail).toBe('Second paragraph still typing here')
  })

  it('splits at line boundary when tail is long', () => {
    const line1 = 'A'.repeat(40)
    const line2 = 'B'.repeat(60)
    const text = `${line1}\n${line2}`
    const out = splitStreamingMarkdown(text)
    expect(out.committed).toBe(`${line1}\n`)
    expect(out.tail).toBe(line2)
  })
})