import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('agent completion semantics (pi-tui aligned)', () => {
  it('agent_end with willRetry must not emit run idle', () => {
    const src = readFileSync(join(root, 'src/worker/worker-session-events.ts'), 'utf8')
    assert.match(src, /case 'agent_end'/)
    assert.match(src, /willRetry/)
    // willRetry path breaks without emitting idle
    const agentEndBlock = src.slice(src.indexOf("case 'agent_end'"), src.indexOf("case 'turn_start'"))
    assert.match(agentEndBlock, /if \(willRetry\)/)
    assert.match(agentEndBlock, /break/)
    // idle emit only after willRetry guard
    const idleIdx = agentEndBlock.indexOf("phase: 'idle'")
    const willRetryIdx = agentEndBlock.indexOf('willRetry')
    assert.ok(willRetryIdx >= 0 && idleIdx > willRetryIdx, 'idle must be after willRetry check')
  })

  it('renderer does not block idle on empty opt-asst alone', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event-run.ts'), 'utf8')
    assert.match(src, /shouldSuppressPrematureRunIdle/)
    assert.doesNotMatch(
      src,
      /startsWith\('opt-asst-'\)/,
      'empty opt-asst must not gate run idle (tool-only turns)',
    )
  })

  it('prompt short-path idle only when !session.isStreaming', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-turn.ts'), 'utf8')
    assert.match(src, /!promptSession\.isStreaming/)
    assert.match(src, /phase: 'idle'/)
  })
})
