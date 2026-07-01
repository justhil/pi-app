import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker modularization budget', () => {
  it('session-event-helpers used via worker-session-events', () => {
    const events = readFileSync(join(root, 'src/worker/worker-session-events.ts'), 'utf8')
    assert.match(events, /session-event-helpers/)
    const helper = readFileSync(join(root, 'src/worker/session-event-helpers.ts'), 'utf8')
    assert.match(helper, /lastAssistantFromMessages/)
    assert.match(helper, /emitAgentErrorFromAssistant/)
  })

  it('index.ts line count <= 1100 (FMSM iter14)', () => {
    const n = readFileSync(join(root, 'src/worker/index.ts'), 'utf8').split('\n').length
    assert.ok(n <= 1100, `worker index ${n} lines`)
  })
})