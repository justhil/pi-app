import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('session switch + rewind performance/reliability', () => {
  it('getMessages is disk-first and never calls workerManager.getMessages', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/session.ts'), 'utf8')
    const start = src.indexOf("ipc:session.getMessages")
    const end = src.indexOf("ipc:session.new", start)
    const block = src.slice(start, end)
    assert.match(block, /getSessionMessagesFromDisk/)
    assert.doesNotMatch(block, /workerManager\.getMessages/)
    assert.match(block, /getSessionLeafOverride/)
  })

  it('navigateTree stores leaf override', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/session.ts'), 'utf8')
    assert.match(src, /setSessionLeafOverride/)
  })

  it('openSession cache hit does not await hydrate', () => {
    const src = readFileSync(join(root, 'src/renderer/src/lib/open-session.ts'), 'utf8')
    assert.match(src, /if \(instant\)/)
    assert.match(src, /void hydrateSessionView/)
  })

  it('loadSession accepts leafId override on worker', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8')
    assert.match(src, /applyLeafOverrideToLiveSession|leafOverride/)
    assert.match(src, /sm\.branch/)
  })

  it('session-leaf-override module exists', () => {
    const src = readFileSync(join(root, 'src/main/session-leaf-override.ts'), 'utf8')
    assert.match(src, /setSessionLeafOverride/)
    assert.match(src, /getSessionLeafOverride/)
  })
})
