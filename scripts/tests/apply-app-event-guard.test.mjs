import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSessionScopedAppEvent } from '../../packages/shared/app-event-session.ts'

const root = process.cwd()

describe('applyAppEvent session guard', () => {
  it('ignores sdk-install-progress for session scope', () => {
    const ev = { type: 'run', phase: 'state', sessionId: 's1' }
    assert.equal(isSessionScopedAppEvent(ev), true)
    const skip = { type: 'sdk-install-progress', sessionId: 's1' }
    assert.equal(isSessionScopedAppEvent(skip), false)
  })

  it('event handlers split by type module', () => {
    const barrel = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event-handlers.ts'), 'utf8')
    assert.match(barrel, /apply-app-event-message/)
    assert.match(barrel, /apply-app-event-run/)
  })
})