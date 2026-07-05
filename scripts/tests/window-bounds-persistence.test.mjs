import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('window bounds persistence', () => {
  it('createWindow restores and persists windowBounds via configStore', () => {
    const src = readFileSync(join(root, 'src/main/window.ts'), 'utf8')
    assert.match(src, /readSavedWindowBounds/)
    assert.match(src, /persistWindowBounds/)
    assert.match(src, /configStore\.set\('windowBounds'/)
    assert.match(src, /attachWindowBoundsPersistence/)
    assert.match(src, /'resize'/)
    assert.match(src, /'close'/)
  })
})