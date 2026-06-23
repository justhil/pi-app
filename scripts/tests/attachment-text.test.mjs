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

test('should add delimiters around file refs in prompt payload', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  const payload = mod.segmentsToPromptPayload([
    { type: 'text', text: '看这个' },
    { type: 'file', attachment: { path: 'C:/tmp/a.png' } },
    { type: 'text', text: '后续文字' },
  ])

  assert.equal(payload, '看这个 @C:/tmp/a.png 后续文字')
})

test('clipboard-image segment uses bare path', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  const payload = mod.segmentsToPromptPayload([
    { type: 'text', text: '看这张图' },
    { type: 'clipboard-image', path: 'C:/tmp/pi-clipboard-1.png', name: 'clipboard-image-1.png' },
    { type: 'text', text: '怎么样' },
  ])

  assert.equal(payload, '看这张图 C:/tmp/pi-clipboard-1.png 怎么样')
})

test('should handle consecutive file and clipboard-image segments', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  const payload = mod.segmentsToPromptPayload([
    { type: 'file', attachment: { path: 'C:/tmp/a.png' } },
    { type: 'clipboard-image', path: 'C:/tmp/pi-clipboard-2.jpg', name: 'clipboard-image-1.png' },
    { type: 'text', text: 'end' },
  ])

  assert.equal(payload, '@C:/tmp/a.png C:/tmp/pi-clipboard-2.jpg end')
})

test('CLIPBOARD_IMAGE_PAYLOAD placeholder text', async () => {
  const mod = await importTs(new URL('../../src/renderer/src/features/composer/attachment-text.ts', import.meta.url))
  assert.equal(mod.CLIPBOARD_IMAGE_PAYLOAD, '[image file]')
})