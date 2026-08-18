import { beforeEach, describe, expect, it } from 'vitest'
import { getSyncedBuiltins, isPiBuiltin, setSyncedBuiltins } from './slash-catalog'

describe('slash-catalog (synced pi builtins)', () => {
  beforeEach(() => {
    setSyncedBuiltins([])
  })

  it('uses the fallback name set until sync lands', () => {
    expect(isPiBuiltin('reload')).toBe(true)
    expect(isPiBuiltin('login')).toBe(true)
    expect(isPiBuiltin('quit')).toBe(true)
    expect(isPiBuiltin('definitely-not-a-builtin')).toBe(false)
  })

  it('prefers the synced list over the fallback after sync', () => {
    setSyncedBuiltins([{ name: 'reload', description: 'Reload' }])

    expect(getSyncedBuiltins()).toEqual([{ name: 'reload', description: 'Reload' }])
    // 同步清单是唯一事实源：不在清单里的旧名字不再视为 pi 内置。
    expect(isPiBuiltin('reload')).toBe(true)
    expect(isPiBuiltin('login')).toBe(false)
  })

  it('ignores non-array sync payloads', () => {
    setSyncedBuiltins(null as unknown as [])

    expect(getSyncedBuiltins()).toEqual([])
  })
})
