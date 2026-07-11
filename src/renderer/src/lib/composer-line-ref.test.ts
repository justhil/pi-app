import { describe, expect, it } from 'vitest'
import { formatLineRef, lineRefToAttachmentMeta } from '@renderer/lib/composer-line-ref'

describe('lineRefToAttachmentMeta', () => {
  it('builds a line-ref attachment chip meta', () => {
    const meta = lineRefToAttachmentMeta({
      path: 'src/a.ts',
      line: 12,
      content: '  const x = 1  ',
    })
    expect(meta.kind).toBe('line-ref')
    expect(meta.path).toBe('src/a.ts')
    expect(meta.name).toBe('a.ts:12')
    expect(meta.line).toBe(12)
    expect(meta.snippet).toBe('const x = 1')
  })

  it('formats range names', () => {
    const meta = lineRefToAttachmentMeta({ path: 'src/a.ts', line: 3, endLine: 8 })
    expect(meta.name).toBe('a.ts:3-8')
  })
})

describe('formatLineRef', () => {
  it('formats path:line with optional snippet', () => {
    expect(formatLineRef({ path: 'src/a.ts', line: 12 })).toBe('src/a.ts:12')
    expect(formatLineRef({ path: 'src/a.ts', line: 12, endLine: 15 })).toBe('src/a.ts:12-15')
  })
})
