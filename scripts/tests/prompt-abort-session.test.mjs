import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('prompt.abort session routing', () => {
  it('main abort uses normalizeSessionKey and does not ignore on path slash mismatch alone', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    assert.match(src, /ipc:prompt\.abort/)
    assert.match(src, /normalizeSessionKey/)
    // Should not use raw === for session match as sole gate
    const abortBlock = src.slice(src.indexOf("ipc:prompt.abort"), src.indexOf('ipc:prompt.dequeueClearQueue'))
    assert.doesNotMatch(abortBlock, /sessionFile === sessionFile/)
    assert.match(abortBlock, /aborted: true/)
  })

  it('workerManager.abort does not ensureSessionWorker', () => {
    const src = readFileSync(join(root, 'src/main/worker-manager.ts'), 'utf8')
    const abortIdx = src.indexOf('async abort(sessionFile')
    const nextMethod = src.indexOf('async steer', abortIdx)
    const block = src.slice(abortIdx, nextMethod)
    assert.doesNotMatch(block, /ensureSessionWorker/)
    assert.match(block, /pool\.get\(sk\)/)
  })

  it('applyComposerAbortUi always clears runtime and does not gate on composerTurnActive', () => {
    const src = readFileSync(join(root, 'src/renderer/src/lib/composer-queue-restore.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export function applyComposerAbortUi'), src.indexOf('export async function restoreQueuedToComposer'))
    assert.doesNotMatch(fn, /if \(\s*!composerTurnActive/)
    assert.match(fn, /setSessionRuntimeRunning/)
  })
})
