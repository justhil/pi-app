import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Clipboard retention and image preview (H-02 M-02)', () => {
  it('timeline replays clipboard-image segments with path', () => {
    const tl = readFileSync(join(root, 'src/renderer/src/features/timeline/timeline.tsx'), 'utf8')
    assert.match(tl, /clipboard-image/)
    assert.match(tl, /AttachmentChip/)
  })

  it('prompt payload keeps temp path for history replay', () => {
    const att = readFileSync(join(root, 'src/renderer/src/features/composer/attachment-text.ts'), 'utf8')
    assert.match(att, /isClipboardTempPath/)
    assert.match(att, /seg\.path/)
  })

  it('image preview allows svg mime', () => {
    const ws = readFileSync(join(root, 'src/main/ipc/handlers/workspace-fs.ts'), 'utf8')
    assert.match(ws, /image\/svg\+xml/)
  })
})