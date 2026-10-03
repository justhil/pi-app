import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPageRuntime, OUTPUT } from '../build-page-runtime.mjs'

describe('browser page runtime bundle', () => {
  it('committed bundle matches src/browser-runtime/page (run: node scripts/build-page-runtime.mjs)', async () => {
    const committed = readFileSync(join(process.cwd(), OUTPUT), 'utf8')
    assert.equal(committed, await buildPageRuntime())
  })
})
