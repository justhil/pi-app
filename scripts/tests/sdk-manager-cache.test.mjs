import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('sdk manager status cache', () => {
  it('sdk.status uses cached reader', () => {
    const ipc = readFileSync(join(root, 'src/main/ipc/handlers/pi-sdk.ts'), 'utf8')
    const block = ipc.match(/registerHandler\('ipc:sdk\.status'[\s\S]*?\n  \}\)/)?.[0] ?? ''
    assert.match(block, /readSdkStatusCached/)
    assert.match(block, /if \(refresh\) clearGlobalSdkPathCache/)
  })

  it('exposes TTL cache helpers', () => {
    const src = readFileSync(join(root, 'src/main/sdk-manager.ts'), 'utf8')
    assert.match(src, /readSdkStatusCached/)
    assert.match(src, /listRegistryVersionsCached/)
    assert.match(src, /invalidateSdkManagerCaches/)
  })
})