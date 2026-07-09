import { describe, expect, it } from 'vitest'
import { normalizeSessionFileKey, sessionFilesEqual } from '../session-file-key'

describe('session-file-key', () => {
  it('normalizes windows drive and separators', () => {
    expect(normalizeSessionFileKey('c:\\tmp\\a.jsonl')).toBe('C:/tmp/a.jsonl')
    expect(normalizeSessionFileKey('C:/tmp/a.jsonl')).toBe('C:/tmp/a.jsonl')
    expect(sessionFilesEqual('c:\\tmp\\a.jsonl', 'C:/tmp/a.jsonl')).toBe(true)
  })

  it('collapses duplicate slashes', () => {
    expect(normalizeSessionFileKey('/tmp//a//b.jsonl')).toBe('/tmp/a/b.jsonl')
  })
})
