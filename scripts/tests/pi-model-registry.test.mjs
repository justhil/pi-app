import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelFromRegistry } from '../../packages/shared/pi-model-registry.ts'

describe('resolveModelFromRegistry', () => {
  it('uses find then get', () => {
    const m = { id: 'x' }
    const reg = { find: () => m, get: () => ({ id: 'y' }) }
    assert.equal(resolveModelFromRegistry(reg, 'p', 'm'), m)
  })
})