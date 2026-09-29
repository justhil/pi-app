import { describe, expect, it } from 'vitest'
import { splitOpenUIFence, splitStreamingMarkdown } from '../markdown-stream-split'

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

  it('never commits half of an open fence', () => {
    const intro = 'Here is the chart for the quarter.\n\n'
    const body = '```pi-ui\n{"component": "chart",\n "props": {"type": "bar",\n "series": [{"name": "Revenue", "data": [1, 2, 3'
    const out = splitStreamingMarkdown(intro + body)
    expect(out.committed).toBe(intro)
    expect(out.tail).toBe(body)
  })

  it('commits a fence once it is closed', () => {
    const text = '```json\n{"a": 1}\n```\n\nAnd then the explanation continues here'
    const out = splitStreamingMarkdown(text)
    expect(out.committed).toBe('```json\n{"a": 1}\n```\n\n')
  })

  it('hands an open pi-ui fence body to the block host', () => {
    expect(splitOpenUIFence('Intro\n```pi-ui\n{"component":')).toEqual({ before: 'Intro\n', raw: '{"component":' })
    expect(splitOpenUIFence('```pi-ui\n{}\n```\nafter')).toBeNull()
    expect(splitOpenUIFence('```json\n{"a":')).toBeNull()
    expect(splitOpenUIFence('```pi-ui')).toBeNull()
  })

  it('keeps an open fence at the start entirely in the tail', () => {
    const text = '```ts\nconst a = 1\n\nconst bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = 2'
    expect(splitStreamingMarkdown(text)).toEqual({ committed: '', tail: text })
  })
})