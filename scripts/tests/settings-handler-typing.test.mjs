import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('settings IPC handler typing', () => {
  it('uses StoreSchema instead of as any for get/set', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/settings.ts'), 'utf8')
    assert.match(src, /keyof StoreSchema/)
    assert.doesNotMatch(src, /as any/)
  })

  it('settings.set uses Zod schema validation', () => {
    const src = readFileSync(join(root, 'src/main/ipc/handlers/settings.ts'), 'utf8')
    assert.match(src, /settingsSetSchema/)
    assert.match(src, /registerHandlerWithSchema\('ipc:settings\.set'/) 
  })
})