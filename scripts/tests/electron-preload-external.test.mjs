import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Electron preload bundle externalization', () => {
  it('marks electron as external in preload build config', () => {
    const config = readFileSync(join(root, 'electron.vite.config.ts'), 'utf8')
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
    const src = readFileSync(built, 'utf8')
    assert.doesNotMatch(src, /Electron failed to install correctly/)
    assert.doesNotMatch(src, /Downloading Electron binary/)
    assert.doesNotMatch(src, /require\("child_process"\)/)
    assert.match(src, /require\("electron"\)/)
  })
})