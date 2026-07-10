import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker loadSession guard', () => {
  it('handleLoadsession refuses to dispose while agent turn is active on another file', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8')
    assert.match(src, /WORKER_AGENT_BUSY/)
    assert.match(src, /st\.session!\.sessionFile/)
  })

  it('session.prepare does not force dispose a busy live session', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/session.ts'), 'utf8')
    const prepareBlock = src.slice(src.indexOf("ipc:session.prepare"), src.indexOf("ipc:session.setEphemeralDraft"))
    assert.match(prepareBlock, /loadSession\(sessionFile\)/)
    assert.doesNotMatch(prepareBlock, /force:\s*true/)
  })

  it('prompt marks agentTurnActive before awaiting session.prompt', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-turn.ts'), 'utf8')
    const promptIdx = src.indexOf('st.promptSent = true')
    const alreadyIdx = src.indexOf('const alreadyStreaming', promptIdx)
    const activeIdx = src.indexOf('st.agentTurnActive = true', promptIdx)
    const awaitIdx = src.indexOf('await promptSession.prompt', promptIdx)
    assert.ok(promptIdx >= 0 && alreadyIdx > promptIdx && activeIdx > alreadyIdx && awaitIdx > activeIdx)
    assert.match(src, /alreadyStreaming && !extra\?\.streamingBehavior/)
  })

  it('workerManager keeps previous cwd when reusing existing foreground worker', () => {
    const src = readFileSync(join(root, 'src/main/worker-manager.ts'), 'utf8')
    // Multi-session pool: keep previous foreground key while promoting the reused slot.
    assert.match(src, /evictIdleWorkers\(/)
    assert.match(src, /keepKeys:\s*prev && prev !== (key|sk) \? \[prev\] : \[\]/)
  })

  it('getState reflects agent turn activity for runtime snapshot', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-catalog.ts'), 'utf8')
    assert.match(src, /isStreaming:\s*st\.session\.isStreaming\s*\|\|\s*st\.agentTurnActive/)
  })

  it('runExtensionCommand passes streamingBehavior when agent is streaming', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8')
    assert.match(src, /streamingBehavior:\s*'followUp'/)
  })
})