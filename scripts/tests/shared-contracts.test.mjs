import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('shared IPC / AppEvent contracts', () => {
  it('ipc-channels list is non-empty and includes session.list', () => {
    const src = readFileSync(join(root, 'packages/shared/ipc-channels.ts'), 'utf8')
    assert.match(src, /export const IPC_INVOKE_CHANNELS/)
    assert.match(src, /ipc:session\.list/)
    assert.match(src, /isAllowedIpcChannel/)
  })

  it('app-event-session guards sdk-install-progress', () => {
    const src = readFileSync(join(root, 'packages/shared/app-event-session.ts'), 'utf8')
    assert.match(src, /sdk-install-progress/)
    assert.match(src, /isSessionScopedAppEvent/)
  })
})