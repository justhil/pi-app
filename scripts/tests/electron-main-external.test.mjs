import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Electron main bundle externalization', () => {
  it('marks electron as external in main build config', () => {
    const config = readFileSync(join(root, 'electron.vite.config.ts'), 'utf8')
    assert.match(config, /external:\s*\[/)
    assert.match(config, /['"]electron['"]/, 'electron must stay runtime external, not bundled from node_modules/electron')
  })

  it('does not bundle npm electron installer wrapper into out/main/index.js after build', () => {
    const built = join(root, 'out/main/index.js')
    if (!existsSync(built)) return
    const src = readFileSync(built, 'utf8')
    assert.doesNotMatch(src, /Electron failed to install correctly/)
    assert.doesNotMatch(src, /Downloading Electron binary/)
  })
})