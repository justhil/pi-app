import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ASR secret redaction', () => {
  it('settings response does not return full codex token', () => {
    const src = readFileSync(join(root, 'src/main/asr-config-store.ts'), 'utf8')
    assert.match(src, /codexAccessTokenSet/)
    assert.match(src, /codexAccessTokenPreview/)
    assert.doesNotMatch(src, /codexAccessToken: token/)
  })

  it('manual auth overlay uses temp path and cleanup', () => {
    const src = readFileSync(join(root, 'src/main/asr/codex-auth.ts'), 'utf8')
    assert.match(src, /tmpdir\(\)/)
    assert.match(src, /clearManualAuthOverlay/)
    assert.match(src, /mode: 0o600/)
  })
})