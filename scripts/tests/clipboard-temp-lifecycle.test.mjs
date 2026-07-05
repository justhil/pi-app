import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('clipboard temp image lifecycle', () => {
  it('tracks temp files and releases them on prompt send/abort', () => {
    const store = readFileSync(join(root, 'src/main/clipboard-temp-images.ts'), 'utf8')
    const prompt = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    assert.match(store, /trackClipboardTempImage/)
    assert.match(store, /releaseAllClipboardTempImages/)
    assert.match(prompt, /trackClipboardTempImage\(filePath\)/)
    assert.match(prompt, /releaseAllClipboardTempImages\(\)/)
  })
})