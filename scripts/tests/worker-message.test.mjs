import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractTextFromPiMessage,
  extractToolResultFromPiMessage,
  piUsageTotals,
} from '../../packages/shared/worker-message.ts'

describe('worker-message', () => {
  it('extractTextFromPiMessage joins text blocks', () => {
    assert.equal(
      extractTextFromPiMessage({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
      'ab',
    )
  })
  it('extractToolResultFromPiMessage reads toolResult blocks', () => {
    assert.equal(
      extractToolResultFromPiMessage({ content: [{ type: 'toolResult', content: 'ok' }] }),
      'ok',
    )
  })
  it('piUsageTotals maps cost', () => {
    const u = piUsageTotals({ input: 1, output: 2, cost: { total: 0.5 } })
    assert.equal(u?.cost, 0.5)
  })
})