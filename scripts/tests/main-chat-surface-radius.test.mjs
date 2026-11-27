import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

function cssVarValues(name) {
  return [...css.matchAll(new RegExp(`${name}:\\s*([^;]*);`, 'g'))].map((m) => m[1].trim())
}

// The 4-column workbench (e92d76cb) replaced the floating "paper" chat surface (16px corner and
// outward shadow) with a flat panel on the window frame. The corner stays themeable via the variable.
test('main chat column is a flat panel on the window frame', () => {
  const shellRule = cssRule('.shell-three-col')
  const trackRule = cssRule('.shell-track-center')
  const surfaceRule = cssRule('.shell-track-center .main-chat-column')

  assert.deepEqual(cssVarValues('--main-chat-surface-radius'), ['0px'])
  for (const name of ['--main-chat-surface-shadow', '--main-chat-surface-shadow-top']) {
    const values = cssVarValues(name)
    assert.ok(values.length >= 2, `${name} is set for light and dark`)
    assert.ok(values.every((v) => v === 'none'), `${name} stays flat in every theme, got ${values.join(' | ')}`)
  }

  assert.match(shellRule, /position:\s*relative/)
  assert.match(shellRule, /z-index:\s*30/)
  assert.match(shellRule, /overflow:\s*visible/)
  assert.match(trackRule, /overflow:\s*visible/)
  assert.match(trackRule, /background:\s*var\(--surface-frame\)/)

  // Only the top-left corner follows the theme variable; content is clipped to it.
  assert.match(surfaceRule, /border-radius:\s*var\(--main-chat-surface-radius\b[^;]*\)\s+0\s+0\s+0/)
  assert.match(surfaceRule, /overflow:\s*hidden/)
  assert.match(surfaceRule, /height:\s*100%/)
  assert.match(surfaceRule, /box-shadow:\s*none/)
  assert.doesNotMatch(css, /--main-chat-surface-shadow:[^;]*\binset\b/s)
})
