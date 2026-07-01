import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatSessionModelKey } from '../../packages/shared/worker-model.ts'

describe('formatSessionModelKey', () => {
  it('joins provider and modelId', () => {
    assert.equal(formatSessionModelKey({ provider: 'openai', modelId: 'gpt-4' }), 'openai/gpt-4')
  })
  it('returns undefined when empty', () => {
    assert.equal(formatSessionModelKey(null), undefined)
  })
})