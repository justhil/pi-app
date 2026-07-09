import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('rewind navigateTree stability', () => {
  it('worker loadSession uses path-normalized equality', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8')
    assert.match(src, /sessionFilePathsEqual/)
    assert.match(src, /Strict === caused dispose/)
  })

  it('navigateTree IPC passes sessionFile through to worker', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/session.ts'), 'utf8')
    const block = src.slice(src.indexOf('ipc:session.navigateTree'), src.indexOf('ipc:session.branchAnchors'))
    assert.match(block, /sessionFile: req\.sessionFile/)
  })

  it('session-rewind fetches history with leafId after navigate', () => {
    const src = readFileSync(join(root, 'src/renderer/src/lib/session-rewind.ts'), 'utf8')
    assert.match(src, /leafId/)
    assert.match(src, /clearLiveSessionTimeline/)
    assert.match(src, /captureFocusFromUiStore/)
  })

  it('getMessages schema accepts leafId', () => {
    const src = readFileSync(join(root, 'src/main/ipc/schemas.ts'), 'utf8')
    assert.match(src, /sessionGetMessagesSchema[\s\S]*leafId/)
  })
})
