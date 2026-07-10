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

  it('session.prepare does not force dispose a busy live session', () => {
    const text = src('src/main/ipc/handlers/session.ts')
    const prepareStart = text.indexOf("ipc:session.prepare")
    const prepareEnd = text.indexOf('ipc:session.setEphemeralDraft')
    assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, 'prepare handler markers')
    const prepareBlock = text.slice(prepareStart, prepareEnd)
    assert.match(prepareBlock, /loadSession\(sessionFile\)/)
    assert.doesNotMatch(prepareBlock, /force:\s*true/)
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

  it('workerManager keeps previous cwd when reusing existing foreground worker', () => {
    const text = src('src/main/worker-manager.ts')
    // Multi-session pool: keep previous foreground key while promoting the reused slot.
    assert.match(text, /evictIdleWorkers\(/)
    assert.match(text, /keepKeys:\s*prev && prev !== (?:key|sk) \? \[prev\] : \[\]/)
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
