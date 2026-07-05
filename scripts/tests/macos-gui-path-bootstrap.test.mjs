import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('macOS GUI PATH bootstrap', () => {
  it('main entry applies fix-path before electron app boot', () => {
    const index = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
    const boot = readFileSync(join(root, 'src/main/bootstrap-path.ts'), 'utf8')
    assert.match(index, /import ['"]\.\/bootstrap-path['"]/)
    const idx = index.indexOf("import './bootstrap-path'")
    const electronIdx = index.indexOf("from 'electron'")
    assert.ok(idx >= 0 && electronIdx > idx)
    assert.match(boot, /fix-path/)
    assert.match(boot, /fixPath\(\)/)
  })
})