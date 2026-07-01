import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('CI quality workflow', () => {
  it('runs npm run lint', () => {
    const yml = readFileSync(join(process.cwd(), '.github/workflows/quality.yml'), 'utf8')
    assert.match(yml, /npm run lint/)
    assert.match(yml, /lint:/)
    assert.match(yml, /build-win/)
    assert.match(yml, /e2e-smoke/)
    assert.match(yml, /script-tests-win/)
  })
})