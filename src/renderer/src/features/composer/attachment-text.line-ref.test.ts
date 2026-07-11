import { describe, expect, it } from 'vitest'
import { segmentsToPromptPayload } from './attachment-text'

describe('segmentsToPromptPayload line-ref', () => {
  it('emits @path:line for line-ref chips', () => {
    const payload = segmentsToPromptPayload([
      { type: 'text', text: 'fix ' },
      {
        type: 'file',
        attachment: {
          path: 'src/a.ts',
          name: 'a.ts:10',
          kind: 'line-ref',
          line: 10,
        },
      },
      { type: 'text', text: ' please' },
    ])
    expect(payload).toBe('fix @src/a.ts:10 please')
  })
})
