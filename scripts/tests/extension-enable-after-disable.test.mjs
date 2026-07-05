import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('extension enable after disable', () => {
  it('toggle target uses unfiltered package extension paths', () => {
    const src = readFileSync(join(root, 'src/main/pi-extension-probe-sync.ts'), 'utf8')
    assert.match(src, /collectPackageExtensionRelPaths/)
    assert.match(src, /resourcePaths:\s*togglePaths/)
  })

  it('package toggle fails loudly when source missing from settings.packages', () => {
    const src = readFileSync(join(root, 'src/main/pi-package-resource-toggle.ts'), 'utf8')
    assert.match(src, /package not in settings\.packages/)
  })
})