import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ASR token preserve on settings save', () => {
  it('saveAsrConfig does not clear secret when codexAccessTokenPreserved', () => {
    const src = readFileSync(join(root, 'src/main/asr-config-store.ts'), 'utf8')
    assert.match(src, /codexAccessTokenPreserved/)
    assert.match(src, /else if \(!cfg\.codexAccessTokenPreserved\)/)
  })

  it('settings response exposes preserved flag for UI', () => {
    const src = readFileSync(join(root, 'src/main/asr-config-store.ts'), 'utf8')
    assert.match(src, /codexAccessTokenPreserved:\s*true/)
  })

  it('asr IPC merges stored token when draft has no plaintext', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/asr.ts'), 'utf8')
    assert.match(src, /mergeStoredCodexAccessToken/)
  })

  it('settings draft keeps preserved metadata from settings.get', () => {
    const src = readFileSync(join(root, 'src/renderer/src/features/settings/settings-draft.ts'), 'utf8')
    assert.match(src, /codexAccessTokenPreserved/)
    assert.match(src, /asrConfigFromSettingsResponse/)
  })
})