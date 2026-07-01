import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('index.html theme bootstrap', () => {
  it('does not swallow theme parse errors silently', () => {
    const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8')
    assert.match(html, /theme bootstrap failed/)
    assert.doesNotMatch(html, /catch \(e\) \{\s*\}/)
  })
})