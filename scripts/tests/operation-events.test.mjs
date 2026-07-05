import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('operation events', () => {
  it('defines structured operation logging without secret fields', () => {
    const src = readFileSync(join(root, 'src/main/operation-events.ts'), 'utf8')
    assert.match(src, /operation: string/)
    assert.match(src, /status: 'start' \| 'ok' \| 'error' \| 'timeout'/)
    assert.doesNotMatch(src, /access_token|apiKey|secret/i)
  })
})