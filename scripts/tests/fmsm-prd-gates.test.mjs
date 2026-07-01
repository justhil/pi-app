import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'

const root = process.cwd()

function lineCount(rel) {
  return readFileSync(join(root, rel), 'utf8').split('\n').length
}

function countAsAny(rel) {
  const text = readFileSync(join(root, rel), 'utf8')
  return (text.match(/\sas any\b/g) || []).length
}

describe('FMSM PRD gates (Overall≥8.0 loop)', () => {
  it('ipc.ts bootstrap <= 500 lines', () => {
    const n = lineCount('src/main/ipc.ts')
    assert.ok(n <= 500, `ipc.ts ${n} lines`)
  })

  it('ui-store.ts <= 400 lines', () => {
    const n = lineCount('src/renderer/src/stores/ui-store.ts')
    assert.ok(n <= 400, `ui-store ${n} lines`)
  })

  it('apply-app-event router <= 120 lines', () => {
    const n = lineCount('src/renderer/src/stores/apply-app-event.ts')
    assert.ok(n <= 120, `apply-app-event ${n} lines`)
  })

  it('worker as any <= 22', () => {
    const n = countAsAny('src/worker/index.ts')
    assert.ok(n <= 22, `worker as any ${n}`)
  })

  it('scripts/tests has >=18 contract test files (Testing≥7 proxy)', () => {
    const files = readdirSync(join(root, 'scripts/tests')).filter((f) => f.endsWith('.test.mjs'))
    assert.ok(files.length >= 18, `test files ${files.length}`)
    assert.ok(files.includes('ipc-channel-sync.test.mjs'))
    assert.ok(files.includes('shared-packages-smoke.test.mjs'))
  })
})