import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('global SDK path (Windows)', () => {
  it('does not cache failed global resolve', () => {
    const src = readFileSync(join(root, 'src/main/sdk-loader.ts'), 'utf8')
    assert.match(src, /clearGlobalSdkPathCache/)
    assert.doesNotMatch(src, /globalSdkPathCache = null/)
  })

  it('falls back to APPDATA npm node_modules on win32', () => {
    const src = readFileSync(join(root, 'src/main/sdk-loader.ts'), 'utf8')
    assert.match(src, /windowsNpmGlobalModuleRoots/)
    assert.match(src, /npm\.cmd/)
  })
})