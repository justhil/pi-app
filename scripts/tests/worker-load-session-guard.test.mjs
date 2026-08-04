import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
/** Normalize CRLF so regex contracts match on Windows CI checkouts. */
const src = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

describe('worker loadSession guard', () => {
  it('handleLoadsession refuses to dispose while agent turn is active on another file', () => {
    const text = src('src/worker/handlers/worker-handlers-session.ts')
    assert.match(text, /WORKER_AGENT_BUSY/)
    assert.match(text, /st\.session!\.sessionFile/)
  })

  it('session.prepare remains disk-only and does not create or bind a worker', () => {
    const text = src('src/main/ipc/handlers/session.ts')
    const prepareStart = text.indexOf("ipc:session.prepare")
    const prepareEnd = text.indexOf('ipc:session.setEphemeralDraft')
    assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, 'prepare handler markers')
    const prepareBlock = text.slice(prepareStart, prepareEnd)
    assert.doesNotMatch(prepareBlock, /loadSession|ensureSessionWorker|workerManager\.start/)
    assert.match(prepareBlock, /resolvePreparedSessionFile\(sessionFile, listSessionsOnDisk\)/)
  })

  it('prompt marks agentTurnActive before awaiting session.prompt', () => {
    const text = src('src/worker/handlers/worker-handlers-turn.ts')
    const promptIdx = text.indexOf('st.promptSent = true')
    const alreadyIdx = text.indexOf('const alreadyStreaming', promptIdx)
    const activeIdx = text.indexOf('st.agentTurnActive = true', promptIdx)
    const awaitIdx = text.indexOf('await promptSession.prompt', promptIdx)
    assert.ok(promptIdx >= 0 && alreadyIdx > promptIdx && activeIdx > alreadyIdx && awaitIdx > activeIdx)
    assert.match(text, /alreadyStreaming && !extra\?\.streamingBehavior/)
  })

  it('workerManager changes foreground only through explicit view-focus paths', () => {
    const text = src('src/main/worker-manager.ts')
    const resolveStart = text.indexOf('private async resolveSlotForRpc')
    const resolveEnd = text.indexOf('private request(', resolveStart)
    assert.ok(resolveStart >= 0 && resolveEnd > resolveStart, 'RPC resolver markers')
    assert.doesNotMatch(text.slice(resolveStart, resolveEnd), /setForeground/)
    assert.match(text, /focusExistingSession\(sessionFile: string\)/)
    assert.match(text, /focusSessionWorker\(sessionFile: string, cwd: string\)/)
  })

  it('getState reflects agent turn activity for runtime snapshot', () => {
    const text = src('src/worker/handlers/worker-handlers-catalog.ts')
    assert.match(text, /isStreaming:\s*st\.session\.isStreaming\s*\|\|\s*st\.agentTurnActive/)
  })

  it('runExtensionCommand passes streamingBehavior when agent is streaming', () => {
    const text = src('src/worker/handlers/worker-handlers-session.ts')
    assert.match(text, /streamingBehavior:\s*'followUp'/)
  })
})
