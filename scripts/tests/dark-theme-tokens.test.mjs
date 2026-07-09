import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8')

function darkBlock(source) {
  const start = source.indexOf('.dark {')
  assert.ok(start >= 0, 'globals.css must define .dark tokens')
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start, 'could not slice .dark block')
  return source.slice(start, end)
}

describe('dark theme visual tokens (VS Code Dark Modern)', () => {
  it('should_match_vscode_dark_modern_surface_and_text_contrast', () => {
    const dark = darkBlock(css)
    // Official Dark Modern workbench tokens (theme-defaults/themes/dark_modern.json)
    assert.match(dark, /--bg-base:\s*#1f1f1f/i, 'editor.background')
    assert.match(dark, /--surface-sidebar:\s*#181818/i, 'sideBar.background')
    assert.match(dark, /--border-base:\s*#2b2b2b/i, 'sideBar.border / panel.border')
    assert.match(dark, /--text-primary:\s*#cccccc/i, 'editor.foreground / foreground')
    assert.match(dark, /--text-secondary:\s*#9d9d9d/i, 'descriptionForeground')
    assert.match(dark, /color-scheme:\s*dark/)
    // Avoid high-contrast pure black / pure white pairing
    assert.doesNotMatch(dark, /--bg-base:\s*#0e0e0e/i)
    assert.doesNotMatch(dark, /--bg-base:\s*#000/i)
    assert.doesNotMatch(dark, /--text-primary:\s*#ffffff/i)
    assert.doesNotMatch(dark, /--text-primary:\s*#eceef4/i)
  })

  it('should_use_neutral_low_chroma_tailwind_tokens', () => {
    const dark = darkBlock(css)
    assert.match(dark, /--background:\s*0\s+0%\s+12%/)
    assert.match(dark, /--foreground:\s*0\s+0%\s+80%/)
    assert.match(dark, /--muted-foreground:\s*0\s+0%\s+62%/)
  })

  it('should_keep_dark_shell_edges_flat_not_bright', () => {
    assert.match(css, /\.dark \.shell-track-center \.main-chat-column/)
    assert.match(css, /\.dark \.composer-shell/)
    assert.doesNotMatch(
      css,
      /\.dark \.shell-track-center \.main-chat-column \{[^}]*#ffffff/,
      'no bright white hairline on chat column',
    )
  })
})
