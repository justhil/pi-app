import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('AppEvent sessionFile routing contract', () => {
  it('AppEventBase carries sessionFile', () => {
    const src = readFileSync(join(root, 'packages/shared/app-events.ts'), 'utf8')
    assert.match(src, /sessionFile\?: string/)
  })

  it('worker baseEvent includes sessionFile from active session', () => {
    const src = readFileSync(join(root, 'src/worker/worker-runtime.ts'), 'utf8')
    assert.match(src, /sessionFile: st\.session\?\.sessionFile/)
  })

  it('apply-app-event routes by sessionFile via resolveAppEventRoute', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event.ts'), 'utf8')
    assert.match(src, /resolveAppEventRoute/)
    assert.doesNotMatch(src, /evSid === workerSid && evSid !== viewSid/)
  })
})