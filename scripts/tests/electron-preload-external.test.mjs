import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

describe('Electron preload bundle externalization', () => {
  it('marks electron as external in preload build config', () => {
    const config = read('electron.vite.config.ts')
    const preloadSection = config.slice(config.indexOf('preload:'))
    assert.match(preloadSection, /rollupOptions:\s*\{/)
    assert.match(
      preloadSection,
      /external:\s*\[[\s\S]*['"]electron['"]/,
      'preload must externalize electron runtime, not bundle node_modules/electron installer',
    )
  })

  it('does not bundle npm electron installer or child_process into out/preload/index.cjs after build', () => {
    const built = join(root, 'out/preload/index.cjs')
    if (!existsSync(built)) return
    const source = readFileSync(built, 'utf8')
    assert.doesNotMatch(source, /Electron failed to install correctly/)
    assert.doesNotMatch(source, /Downloading Electron binary/)
    assert.doesNotMatch(source, /require\(["']child_process["']\)/)
    // Vite may emit require("electron") or require('electron') depending on version/platform.
    assert.match(source, /require\(["']electron["']\)/)
  })
})
