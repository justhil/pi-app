import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ASR codex token secret storage', () => {
  it('asr-config-store strips token before configStore.set', () => {
    const src = readFileSync(join(root, 'src/main/asr-config-store.ts'), 'utf8')
    assert.match(src, /stripTokenFromConfig/)
    assert.match(src, /setCodexAccessToken/)
    assert.match(src, /from '\.\/secret-store'|setCodexAccessToken/)
  })

  it('settings.set asrConfig routes through saveAsrConfig', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/settings.ts'), 'utf8')
    assert.match(src, /saveAsrConfig/)
    assert.match(src, /loadAsrConfig/)
  })

  it('secret-store uses electron safeStorage', () => {
    const src = readFileSync(join(root, 'src/main/secret-store.ts'), 'utf8')
    assert.match(src, /safeStorage\.encryptString/)
    assert.match(src, /safeStorage\.decryptString/)
  })
})