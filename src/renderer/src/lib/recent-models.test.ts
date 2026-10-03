import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRecentModels, rememberRecentModel } from './recent-models'

afterEach(() => vi.unstubAllGlobals())

describe('recent models', () => {
  it('moves the picked model to the front and caps the list', () => {
    expect(rememberRecentModel('a/x', ['b/y', 'a/x', 'c/z', 'd/1', 'e/2', 'f/3'])).toEqual(['a/x', 'b/y', 'c/z', 'd/1', 'e/2'])
  })

  it('survives missing storage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readRecentModels()).toEqual([])
    expect(rememberRecentModel('a/x', [])).toEqual(['a/x'])
  })
})
