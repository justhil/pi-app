import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((m) => m[1])
    .join('\n')
}

test('should_provide_default_non_zero_shell_corner_radius_in_globals_css', () => {
  const shellRule = cssRule('.shell-three-col')
  const trackRule = cssRule('.shell-track-center')
  const surfaceRule = cssRule('.shell-track-center .main-chat-column')
  const settingsRule = cssRule('.settings-main')

  // Default main surface corner radius matches DEFAULT_UI_CUSTOMIZATION.shellCornerRadius (12px), never 0px.
  assert.match(css, /--main-chat-surface-radius:\s*12px/)
  assert.doesNotMatch(css, /:root\s*\{[\s\S]*?--main-chat-surface-radius:\s*0(?:px)?;/)
  assert.match(shellRule, /position:\s*relative/)
  assert.match(shellRule, /z-index:\s*30/)
  assert.match(shellRule, /overflow:\s*visible/)
  assert.match(trackRule, /overflow:\s*visible/)
  assert.match(trackRule, /background:\s*var\(--surface-frame\)/)
  assert.match(surfaceRule, /border-radius:\s*var\(--main-chat-surface-radius,\s*var\(--shell-corner-radius,\s*12px\)\)\s+0\s+0\s+0/)
  assert.doesNotMatch(surfaceRule, /border-radius:\s*0(?:px|rem|em|%|\s*;)/)
  assert.match(surfaceRule, /overflow:\s*hidden/)
  assert.match(surfaceRule, /height:\s*100%/)
  assert.match(settingsRule, /border-top-left-radius:\s*var\(--main-chat-surface-radius,\s*var\(--shell-corner-radius,\s*12px\)\)/)
})

test('should_prevent_island_mode_frame_double_tinting_around_rounded_corners', () => {
  // Island mode must paint --surface-frame once on .app-viewport and keep outer chrome children
  // transparent so translucent themes do not draw a brighter rectangular box around island corners.
  const islandChromePattern =
    /html\[data-frame-style='island'\]\s+\.app-viewport\s+\.electron-drag[\s\S]*?html\[data-frame-style='island'\]\s+\[data-pi-slot='left-activity-rail'\][\s\S]*?html\[data-frame-style='island'\]\s+\.shell-track-left[\s\S]*?html\[data-frame-style='island'\]\s+\.workbench-statusbar\s*\{[^}]*background:\s*transparent\s*!important/
  assert.match(css, islandChromePattern)
})
