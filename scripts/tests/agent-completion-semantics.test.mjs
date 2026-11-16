import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('agent completion semantics (pi-tui aligned)', () => {
  it('agent_end is nonterminal and agent_settled owns completion', () => {
    const src = readFileSync(join(root, 'src/worker/worker-session-events.ts'), 'utf8')
    assert.match(src, /case 'agent_end'/)
    assert.match(src, /case 'agent_settled'/)
    const agentEndBlock = src.slice(src.indexOf("case 'agent_end'"), src.indexOf("case 'turn_start'"))
    assert.doesNotMatch(agentEndBlock, /phase: 'idle'/)
    assert.doesNotMatch(agentEndBlock, /setAgentTurnActive\(false\)/)
    const settledBlock = src.slice(src.indexOf("case 'agent_settled'"), src.indexOf("case 'turn_start'"))
    assert.match(settledBlock, /emitSettledRun\(deps\)/)
    assert.match(src, /function emitSettledRun[\s\S]*setAgentTurnActive\(false\)/)
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

  it('prompt preflight is visible while agent completion remains settlement-owned', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-turn.ts'), 'utf8')
    assert.match(src, /beginRunIdentity\(\)[\s\S]*promptPreflightActive\s*=\s*true[\s\S]*phase:\s*'started'/)
    assert.match(src, /if \(!alreadyStreaming && st\.promptPreflightActive\)[\s\S]*phase:\s*abortedDuringPreflight\s*\?\s*'cancelled'\s*:\s*'idle'/)
    assert.doesNotMatch(src, /phase:\s*'idle',[\s\S]*settled:\s*true/)
    assert.match(src, /await session\.abort\(\)/)
  })
})
