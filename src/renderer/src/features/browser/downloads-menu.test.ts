import { describe, expect, it } from 'vitest'
import { formatBytes } from './downloads-menu'

describe('formatBytes', () => {
  it('uses short binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(6 * 1024 * 1024)).toBe('6.0 MB')
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB')
  })
})
