import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('renderer ipc invoke channel names', () => {
  it('no invoke(runtime.getState without ipc: prefix', () => {
    const files = [
      'src/renderer/src/lib/session-display-meta.ts',
      'src/renderer/src/lib/sync-session-model.ts',
    ]
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8')
      assert.doesNotMatch(src, /invoke\(\s*['"]runtime\.getState/)
      assert.match(src, /ipc:runtime\.getState/)
    }
  })
})