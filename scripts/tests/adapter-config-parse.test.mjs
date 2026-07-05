import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('adapter shared config parse safety', () => {
  it('blocks overwrite when shared config JSON is invalid', () => {
    const src = readFileSync(join(root, 'src/extension-compat/adapter-backend.ts'), 'utf8')
    assert.match(src, /invalid_json/)
    assert.match(src, /repair the file before saving/)
    assert.match(src, /__configFileError/)
  })
})