import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
/** Normalize CRLF so regex contracts match on Windows CI checkouts. */
const src = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

describe('prompt.abort session routing', () => {
  it('main abort uses normalizeSessionKey and does not ignore on path slash mismatch alone', () => {
    const text = src('src/main/ipc/handlers/prompt.ts')
    assert.match(text, /ipc:prompt\.abort/)
    assert.match(text, /normalizeSessionKey/)
    const abortStart = text.indexOf('ipc:prompt.abort')
    const abortEnd = text.indexOf('ipc:prompt.dequeueClearQueue')
    assert.ok(abortStart >= 0 && abortEnd > abortStart, 'abort handler markers')
    const abortBlock = text.slice(abortStart, abortEnd)
    assert.doesNotMatch(abortBlock, /sessionFile === sessionFile/)
    assert.match(abortBlock, /aborted:\s*true/)
  })

  it('workerManager.abort does not ensureSessionWorker', () => {
    const text = src('src/main/worker-manager.ts')
    const abortIdx = text.indexOf('async abort(sessionFile')
    const nextMethod = text.indexOf('async steer', abortIdx)
    assert.ok(abortIdx >= 0 && nextMethod > abortIdx, 'abort/steer markers')
    const block = text.slice(abortIdx, nextMethod)
    assert.doesNotMatch(block, /ensureSessionWorker/)
    assert.match(block, /pool\.get\(sk\)/)
  })

  it('applyComposerAbortUi always clears runtime and does not gate on composerTurnActive', () => {
    const text = src('src/renderer/src/lib/composer-queue-restore.ts')
    const fnStart = text.indexOf('export function applyComposerAbortUi')
    const fnEnd = text.indexOf('export async function restoreQueuedToComposer')
    assert.ok(fnStart >= 0 && fnEnd > fnStart, 'applyComposerAbortUi markers')
    const fn = text.slice(fnStart, fnEnd)
    assert.doesNotMatch(fn, /if \(\s*!composerTurnActive/)
    assert.match(fn, /setSessionRuntimeRunning/)
  })
})
