import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('config-store typing', () => {
  it('uses Store<StoreSchema> without pkg as any', () => {
    const src = readFileSync(join(process.cwd(), 'src/main/config-store.ts'), 'utf8')
    assert.match(src, /new Store<StoreSchema>/)
    assert.doesNotMatch(src, /pkg as any/)
    assert.doesNotMatch(src, /const Store = pkg/)
  })
})