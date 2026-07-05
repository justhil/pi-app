import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker modularization (FMSM iter14)', () => {
  it('split modules exist and entry wires port handlers + runtime', () => {
    for (const f of [
      'worker-timeline.ts',
      'worker-session-events.ts',
      'worker-compaction-patch.ts',
      'worker-runtime.ts',
      'worker-port-handlers.ts',
    ]) {
      assert.ok(existsSync(join(root, 'src/worker', f)), f)
    }
    assert.ok(existsSync(join(root, 'packages/shared/pi-message-update.ts')), 'packages/shared/pi-message-update.ts')
    const index = readFileSync(join(root, 'src/worker/index.ts'), 'utf8')
    assert.match(index, /worker-port-handlers/)
    assert.match(index, /worker-runtime/)
    assert.doesNotMatch(index, /function normalizeMessages\(/)
    assert.doesNotMatch(index, /switch \(msg\.type\)/)
  })
})