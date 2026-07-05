import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('markdown copy accessibility', () => {
  it('icon-only copy button exposes aria-label and focus-visible', () => {
    const src = readFileSync(join(root, 'src/renderer/src/features/timeline/markdown-view.tsx'), 'utf8')
    assert.match(src, /aria-label=\{copied \? t\('timeline:copied'\) : t\('timeline:copy'\)\}/)
    assert.match(src, /focus-visible:opacity-100/)
  })
})