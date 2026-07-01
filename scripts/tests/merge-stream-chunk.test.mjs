import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStreamChunk } from '../../packages/shared/stream-merge.ts'

describe('mergeStreamChunk', () => {
  it('appends incremental delta', () => {
    assert.equal(mergeStreamChunk('ab', 'c'), 'abc')
  })
  it('ignores duplicate full snapshot', () => {
    assert.equal(mergeStreamChunk('hello', 'hello'), 'hello')
  })
  it('replaces when delta is cumulative prefix', () => {
    assert.equal(mergeStreamChunk('hi', 'hi there'), 'hi there')
  })
})