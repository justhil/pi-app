import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8')
const view = readFileSync(
  join(root, 'src/renderer/src/features/timeline/session-open-loading.tsx'),
  'utf8',
)

describe('session open loading dark theme', () => {
  it('should_define_dark_pixel_tokens_on_document_root', () => {
    assert.match(css, /\.dark\s*\{[\s\S]*--session-pixel-ink:\s*#cccccc/i)
    assert.match(css, /\.dark\s*\{[\s\S]*--session-pixel-surface:\s*#252526/i)
    assert.match(css, /--session-pixel-card-shadow/)
    assert.match(css, /--session-pixel-shadow-dim/)
  })

  it('should_not_hardcode_light_fallbacks_in_session_open_loading', () => {
    assert.doesNotMatch(view, /#f3f3f3/i)
    assert.doesNotMatch(view, /#1a1a1a/i)
    assert.doesNotMatch(view, /session-pixel-surface,\s*#/i)
    assert.doesNotMatch(view, /session-pixel-ink,\s*#/i)
    assert.match(view, /session-pixel-loading/)
    assert.match(view, /readSessionPixelShadowTokens|getComputedStyle/)
    assert.match(view, /--session-pixel-surface/)
    assert.match(view, /--session-pixel-ink/)
  })
})
