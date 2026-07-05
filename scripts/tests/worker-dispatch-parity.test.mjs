import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const V410_FIXTURE = join(root, 'scripts/tests/fixtures/worker-index-v0.4.10.ts')

function readV410WorkerIndex() {
  try {
    return readFileSync(V410_FIXTURE, 'utf8')
  } catch {
    return execSync('git show v0.4.10:src/worker/index.ts', { encoding: 'utf8', cwd: root })
  }
}

function v410WorkerCases() {
  const src = readV410WorkerIndex()
  return [...src.matchAll(/case '([^']+)':/g)].map((m) => m[1]).sort()
}

function dispatchKeys() {
  const port = readFileSync(join(root, 'src/worker/worker-port-handlers.ts'), 'utf8')
  const start = port.indexOf("const dispatch")
  assert.ok(start >= 0, 'dispatch table')
  const slice = port.slice(start)
  return [...slice.matchAll(/'([a-zA-Z0-9-]+)':\s*(?:Turn|Session|Catalog|PiSettings)\.handle/g)].map((m) => m[1]).sort()
}

function replyTypesInHandlers() {
  const dir = join(root, 'src/worker/handlers')
  const files = ['worker-handlers-turn.ts', 'worker-handlers-session.ts', 'worker-handlers-catalog.ts', 'worker-handlers-pi-settings.ts']
  const types = new Set()
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const m of text.matchAll(/reply\(\{\s*type:\s*'([^']+)'/g)) types.add(m[1])
  }
  return [...types].sort()
}

function v410ReplyTypes() {
  const src = readV410WorkerIndex()
  return [...new Set([...src.matchAll(/reply\(\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]))].sort()
}

describe('worker modularization parity vs v0.4.10', () => {
  it('dispatch table covers all v0.4.10 switch cases', () => {
    const cases = v410WorkerCases()
    const keys = dispatchKeys()
    const missing = cases.filter((c) => !keys.includes(c))
    assert.deepEqual(missing, [], `missing dispatch keys: ${missing.join(', ')}`)
  })

  it('reply type strings unchanged for known RPC flows', () => {
    const v410 = new Set(v410ReplyTypes())
    const now = replyTypesInHandlers()
    const critical = [
      'init-done',
      'getMessages-done',
      'loadSession-done',
      'navigateTree-done',
      'getState-done',
      'getModels-done',
      'getSessionContextPreview-done',
      'getContextPrompts-done',
    ]
    for (const t of critical) {
      assert.ok(v410.has(t), `v0.4.10 missing reply type ${t}`)
      assert.ok(now.includes(t), `handlers missing reply type ${t}`)
    }
  })

  it('no bogus st.session-manager path in shared JSONL reader', () => {
    const shared = readFileSync(join(root, 'packages/shared/session-jsonl-timeline.ts'), 'utf8')
    assert.doesNotMatch(shared, /st\.session-manager/)
    assert.match(shared, /session-manager\.js/)
  })
})