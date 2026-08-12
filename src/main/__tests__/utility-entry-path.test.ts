import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => join('D:', 'workspace', 'pi-app')) },
}))

import { resolveUtilityEntry } from '../utility-entry-path'

describe('resolveUtilityEntry', () => {
  it('should_resolve_worker_and_preview_from_the_app_root_when_callers_are_split_into_chunks', () => {
    const appPath = join('D:', 'workspace', 'pi-app')

    expect(resolveUtilityEntry('worker.mjs', appPath)).toBe(
      join(appPath, 'out', 'main', 'worker.mjs'),
    )
    expect(resolveUtilityEntry('preview.mjs', appPath)).toBe(
      join(appPath, 'out', 'main', 'preview.mjs'),
    )
    expect(resolveUtilityEntry('preview-wsl.mjs', appPath)).toBe(
      join(appPath, 'out', 'main', 'preview-wsl.mjs'),
    )
    expect(resolveUtilityEntry('worker.mjs', appPath)).not.toContain(
      join('out', 'main', 'chunks', 'worker.mjs'),
    )
  })
})
