import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFilePath } from '../attachments'

describe('resolveFilePath', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      ...window,
      piDesktop: {
        getPathForFile: vi.fn(() => {
          throw new Error('Could not resolve file path for attachment')
        }),
      },
    })
  })

  it('returns undefined for clipboard image File instead of throwing', () => {
    const file = new File(['x'], 'paste.png', { type: 'image/png' })
    expect(resolveFilePath(file)).toBeUndefined()
  })
})