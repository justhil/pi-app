import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const IPC_MAIN = join(root, 'src/main/ipc.ts')
const MAX_LINES = 500

describe('ipc.ts size budget (strict arch)', () => {
  it(`ipc.ts line count <= ${MAX_LINES}`, () => {
    const lines = readFileSync(IPC_MAIN, 'utf8').split('\n').length
    assert.ok(
      lines <= MAX_LINES,
      `ipc.ts has ${lines} lines; strict budget is ${MAX_LINES}. Split more handlers.`,
    )
  })
})