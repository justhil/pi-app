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

test('clipboard temp file path is bare in prompt payload (TUI style)', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  const temp = 'C:/Users/x/AppData/Local/Temp/pi-clipboard-abc.png'
  const payload = mod.segmentsToPromptPayload([
    { type: 'text', text: 'see' },
    { type: 'file', attachment: { path: temp } },
    { type: 'text', text: 'ok' },
  ])
  assert.equal(payload, `see ${temp} ok`)
})

test('regular file refs still use @ prefix', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  const payload = mod.segmentsToPromptPayload([
    { type: 'file', attachment: { path: 'C:/tmp/a.png' } },
  ])
  assert.equal(payload, '@C:/tmp/a.png')
})