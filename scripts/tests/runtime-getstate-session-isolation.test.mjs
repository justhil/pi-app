import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('runtime getState session isolation', () => {
  it('getState(sessionFile) does not fall back to foreground worker', () => {
    const src = readFileSync(join(root, 'src/main/worker-manager.ts'), 'utf8')
    assert.match(src, /async getState\(sessionFile\?: string\)/)
    // Must look up pool by session key and return idle when missing
    assert.match(src, /const slot = this\.pool\.get\(sk\)/)
    assert.match(src, /isStreaming: false/)
    // Must not call ensureSessionWorker from getState path for status polls
    const getStateBlock = src.slice(src.indexOf('async getState(sessionFile'), src.indexOf('async getCommands'))
    assert.doesNotMatch(getStateBlock, /ensureSessionWorker/)
  })

  it('fetchWorkerLiveSnapshot does not attribute foreign isStreaming to requested session', () => {
    const src = readFileSync(join(root, 'src/renderer/src/lib/session-worker-sync.ts'), 'utf8')
    assert.match(src, /sessionFilesEqual\(repliedFile, requested\)/)
    assert.match(src, /status: 'idle'/)
  })
})
