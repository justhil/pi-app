import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('renderer sandbox toggle (FMSM M1)', () => {
  it('window.ts exports readRendererSandboxEnabled and wires sandbox', () => {
    const src = readFileSync(join(process.cwd(), 'src/main/window.ts'), 'utf8')
    assert.match(src, /export function readRendererSandboxEnabled/)
    assert.match(src, /PI_RENDERER_SANDBOX=0/)
    assert.match(src, /sandbox: readRendererSandboxEnabled\(\)/)
  })
})