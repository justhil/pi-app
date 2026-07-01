import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('CONTRIBUTING audit policy (FMSM Info)', () => {
  it('documents critical vs high npm audit', () => {
    const md = readFileSync(join(process.cwd(), 'doc/CONTRIBUTING.md'), 'utf8')
    assert.match(md, /critical/i)
    assert.match(md, /high/i)
    assert.match(md, /ci-audit/)
  })
})