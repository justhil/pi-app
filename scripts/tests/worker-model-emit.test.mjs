import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker session model formatting', () => {
  it('worker uses formatSessionModelKey instead of session.model as any', () => {
    const runtime = readFileSync(join(root, 'src/worker/worker-runtime.ts'), 'utf8')
    assert.match(runtime, /formatSessionModelKey/)
    assert.doesNotMatch(runtime, /\(session\.model as any\)/)
    const handlers = readFileSync(join(root, 'src/worker/worker-port-handlers.ts'), 'utf8')
    assert.doesNotMatch(handlers, /\(session\.model as any\)/)
  })
})