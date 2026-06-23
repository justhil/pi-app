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

test('should enter fresh temporary draft when persisted workspace is sandbox', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/boot-workspace-state.ts', import.meta.url))
  const state = mod.resolveBootWorkspaceState('C:/Users/me/AppData/Roaming/pi-desktop/sandbox-workspaces/abc123')

  assert.equal(state.workspace, null)
  assert.equal(state.ephemeralDraft, true)
  assert.equal(state.shouldStartWorker, false)
})

test('should keep disk project as project-home new-session entry on boot', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/lib/boot-workspace-state.ts', import.meta.url))
  const state = mod.resolveBootWorkspaceState('D:/workspace/pi-app')

  assert.equal(state.workspace, 'D:/workspace/pi-app')
  assert.equal(state.ephemeralDraft, false)
  assert.equal(state.shouldStartWorker, true)
})
