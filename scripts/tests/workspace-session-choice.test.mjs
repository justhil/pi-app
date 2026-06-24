import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function importTs(path) {
  const source = await readFile(path, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

test('should choose explicit existing sandbox session even when session list is empty', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/workspace-session-choice.ts', import.meta.url))
  const choice = mod.chooseWorkspaceSession([], {
    sessionId: 'session-abc',
    sessionFile: 'C:/Users/me/.pi/agent/sessions/demo/session.jsonl',
  })

  assert.deepEqual(choice, {
    sessionId: 'session-abc',
    sessionFile: 'C:/Users/me/.pi/agent/sessions/demo/session.jsonl',
  })
})

test('should fall back to newest session from list when no explicit session is provided', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/workspace-session-choice.ts', import.meta.url))
  const newest = { sessionId: 'newest', sessionFile: 'newest.jsonl' }
  const choice = mod.chooseWorkspaceSession([newest, { sessionId: 'old', sessionFile: 'old.jsonl' }])

  assert.equal(choice, newest)
})

test('should ignore session rows without a session file', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/workspace-session-choice.ts', import.meta.url))
  const choice = mod.chooseWorkspaceSession([
    { sessionId: 'unrestorable' },
    { sessionId: 'restorable', sessionFile: 'restorable.jsonl' },
  ])

  assert.deepEqual(choice, { sessionId: 'restorable', sessionFile: 'restorable.jsonl' })
})

test('should return null when no restorable session exists', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/workspace-session-choice.ts', import.meta.url))
  const choice = mod.chooseWorkspaceSession([{ sessionId: 'unrestorable' }])

  assert.equal(choice, null)
})
