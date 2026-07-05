import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ASR manual auth overlay lifecycle (M-01)', () => {
  it('clears overlay on child exit and stop', () => {
    const mgr = readFileSync(join(root, 'src/main/asr/codex-asr-manager.ts'), 'utf8')
    assert.match(mgr, /proc\.on\('exit'/)
    assert.match(mgr, /clearManualAuthOverlay\(\)/)
    const stops = (mgr.match(/clearManualAuthOverlay/g) || []).length
    assert.ok(stops >= 2, 'expected clear on exit and stop')
  })
})