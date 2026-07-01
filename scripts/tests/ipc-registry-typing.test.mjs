import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('IPC registry boundary types', () => {
  it('exports IpcInvokeBody for documented invoke shape', () => {
    const src = readFileSync(join(root, 'src/main/ipc/registry.ts'), 'utf8')
    assert.match(src, /export type IpcInvokeBody/)
    assert.match(src, /IPC-CONTRACTS/)
  })
  it('IPC-CONTRACTS.md documents settings channel', () => {
    const doc = readFileSync(join(root, 'doc/IPC-CONTRACTS.md'), 'utf8')
    assert.match(doc, /ipc:settings/)
  })
})