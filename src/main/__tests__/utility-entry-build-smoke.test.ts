import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: vi.fn(() => process.cwd()) } }))

import { resolveUtilityEntry } from '../utility-entry-path'

describe('built utility entries', () => {
  it('should_exist_beside_the_built_main_entry_after_build', () => {
    expect(existsSync(resolveUtilityEntry('worker.mjs'))).toBe(true)
    expect(existsSync(resolveUtilityEntry('preview.mjs'))).toBe(true)
    expect(existsSync(resolveUtilityEntry('preview-wsl.mjs'))).toBe(true)
  })
})
