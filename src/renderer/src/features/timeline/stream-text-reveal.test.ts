import { describe, expect, it } from 'vitest'
import { STREAM_REVEAL_MAX_LAG_CHARS, STREAM_REVEAL_TIP_CHARS } from './stream-text-reveal'

describe('stream reveal tip budget', () => {
  it('uses at most two newest characters for soft fade tip', () => {
    expect(STREAM_REVEAL_TIP_CHARS).toBe(2)
    expect(STREAM_REVEAL_MAX_LAG_CHARS).toBe(2)
  })
})
