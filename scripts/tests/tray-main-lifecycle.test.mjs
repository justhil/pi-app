import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

describe('Main tray lifecycle contract', () => {
  it('creates the tray after ready and destroys it before any graceful-shutdown early return', () => {
    const readyBlock = source.slice(source.indexOf('app.whenReady()'), source.indexOf("let isQuittingGracefully"))
    assert.match(readyBlock, /ensureAppTray\(\)/)

    const beforeQuit = source.match(/app\.on\(['"]before-quit['"],\s*\(event\)\s*=>\s*\{([\s\S]*?)\n\}\)/)?.[1]
    assert.ok(beforeQuit, 'before-quit handler must exist')
    const destroyPosition = beforeQuit.indexOf('destroyAppTray()')
    const earlyReturnPosition = beforeQuit.indexOf('if (isQuittingGracefully) return')
    assert.ok(destroyPosition >= 0, 'before-quit must destroy the tray')
    assert.ok(earlyReturnPosition >= 0, 'before-quit must preserve graceful shutdown guard')
    assert.ok(
      destroyPosition < earlyReturnPosition,
      'tray cleanup must run even when window-all-closed already started graceful shutdown',
    )
  })
})
