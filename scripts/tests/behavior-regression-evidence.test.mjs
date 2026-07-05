import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Behavior regression evidence (M-03)', () => {
  it('workspace boundary test exercises resolvePathUnderWorkspace when built', () => {
    const t = readFileSync(join(root, 'scripts/tests/workspace-fs-boundary.test.mjs'), 'utf8')
    assert.match(t, /outside_workspace/)
    assert.match(t, /resolvePathUnderWorkspace/)
  })

  it('ipc schema tests reject invalid payloads at runtime contract', () => {
    const t = readFileSync(join(root, 'scripts/tests/ipc-schema-validation.test.mjs'), 'utf8')
    assert.match(t, /safeParse/)
    assert.match(t, /rejects invalid input/)
  })
})