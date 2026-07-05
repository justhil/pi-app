import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('session.getMessages disk preview', () => {
  it('IPC handler does not hard-fail with worker_not_ready when worker is down', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/session.ts'), 'utf8')
    const start = src.indexOf("registerHandlerWithSchema('ipc:session.getMessages'")
    const end = src.indexOf("registerHandlerWithSchema('ipc:session.new'", start)
    assert.ok(start >= 0 && end > start)
    const block = src.slice(start, end)
    assert.doesNotMatch(block, /worker_not_ready/)
    assert.match(block, /getSessionMessagesFromDisk/)
  })

  it('shared JSONL timeline helper exists for main and worker', () => {
    assert.ok(readFileSync(join(root, 'packages/shared/session-jsonl-timeline.ts'), 'utf8').includes('buildTimelinePageFromSessionFile'))
    assert.match(
      readFileSync(join(root, 'src/worker/handlers/worker-handlers-session.ts'), 'utf8'),
      /buildTimelinePageFromSessionFile/,
    )
  })
})