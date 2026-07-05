import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('session history getMessages (disk JSONL)', () => {
  it('shared timeline reader uses session-manager.js like session-tree-from-file', () => {
    const shared = readFileSync(join(root, 'packages/shared/session-jsonl-timeline.ts'), 'utf8')
    const treeFromFile = readFileSync(join(root, 'src/main/session-tree-from-file.ts'), 'utf8')
    const workerSession = readFileSync(
      join(root, 'src/worker/handlers/worker-handlers-session.ts'),
      'utf8',
    )
    assert.doesNotMatch(shared, /st\.session-manager/)
    assert.match(shared, /session-manager\.js/)
    assert.match(treeFromFile, /session-manager\.js/)
    assert.match(workerSession, /buildTimelinePageFromSessionFile/)
  })
})