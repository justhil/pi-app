import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('ci-audit policy (F-13)', () => {
  it('fails only on critical, warns on high', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/ci-audit.mjs'), 'utf8')
    assert.match(src, /critical vulnerabilities present — failing/)
    assert.match(src, /process\.exit\(1\)/)
    assert.doesNotMatch(src, /high vulnerabilities present — failing/)
    assert.match(src, /high vulnerabilities present \(non-blocking\)/)
  })

  it('CONTRIBUTING matches critical-block / high-warn policy', () => {
    const md = readFileSync(join(process.cwd(), 'doc/CONTRIBUTING.md'), 'utf8')
    assert.match(md, /critical.*失败|critical.*CI 红/i)
    assert.match(md, /high.*warn|high.*不阻断|仅 \*\*warn\*\*/i)
  })
})