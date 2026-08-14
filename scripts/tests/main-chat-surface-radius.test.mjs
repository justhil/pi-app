import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

test('main chat paper surface casts outward onto the sidebar and top chrome', () => {
  const shellRule = cssRule('.shell-three-col')
  const trackRule = cssRule('.shell-track-center')
  const surfaceRule = cssRule('.shell-track-center .main-chat-column')

  assert.match(css, /--main-chat-surface-radius:\s*16px/)
  assert.match(css, /--main-chat-surface-shadow:\s*\n\s*-3px 0 8px -4px rgba\(18, 24, 40, 0\.14\),\s*\n\s*var\(--main-chat-surface-shadow-top\)/)
  assert.match(css, /--main-chat-surface-shadow-top:\s*0 -2px 6px -3px rgba\(18, 24, 40, 0\.1\)/)
  assert.match(css, /\.dark[^{]*\{[^}]*--main-chat-surface-shadow-top:\s*0 -2px 6px -3px rgba\(0, 0, 0, 0\.2\)/s)
  assert.match(css, /\.dark[^{]*\{[^}]*--main-chat-surface-shadow:\s*\n\s*-3px 0 8px -4px rgba\(0, 0, 0, 0\.28\),\s*\n\s*var\(--main-chat-surface-shadow-top\)/s)
  assert.doesNotMatch(css, /--main-chat-surface-shadow:[^;]*\binset\b/s)
  assert.match(shellRule, /position:\s*relative/)
  assert.match(shellRule, /z-index:\s*30/)
  assert.match(shellRule, /overflow:\s*visible/)
  assert.match(trackRule, /overflow:\s*visible/)
  assert.match(trackRule, /background:\s*var\(--surface-sidebar\)/)
  assert.match(surfaceRule, /border-radius:\s*var\(--main-chat-surface-radius\)\s+0\s+0\s+0/)
  assert.doesNotMatch(surfaceRule, /border-radius:\s*0(?:px|rem|em|%|\s*;)/)
  assert.match(surfaceRule, /overflow:\s*hidden/)
  assert.match(surfaceRule, /height:\s*100%/)
  assert.match(surfaceRule, /box-shadow:\s*var\(--main-chat-surface-shadow\)/)
})
