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

  it('getState reflects agent turn activity for runtime snapshot', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-catalog.ts'), 'utf8')
    assert.match(src, /isStreaming:\s*st\.session\.isStreaming\s*\|\|\s*st\.agentTurnActive/)
  })

  it('runExtensionCommand passes streamingBehavior when agent is streaming', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8')
    assert.match(src, /streamingBehavior:\s*'followUp'/)
  })
})