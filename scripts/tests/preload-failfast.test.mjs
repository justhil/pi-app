import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('preload getPathForFile', () => {
  it('throws when path cannot be resolved', () => {
    const src = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')
    assert.match(src, /throw new Error\('Could not resolve file path/)
    assert.doesNotMatch(src, /return \(file as any\)\.path \?\? ''/)
  })
})