import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assistantStreamDeltaFromMessageUpdate } from '../../packages/shared/pi-message-update.ts'
import { extractThinkingFromPiMessage } from '../../packages/shared/worker-message.ts'
import { mergeStreamChunk } from '../../packages/shared/stream-merge.ts'

describe('assistantStreamDeltaFromMessageUpdate', () => {
  it('uses cumulative partial assistant message like pi-tui', () => {
    const stream = assistantStreamDeltaFromMessageUpdate(
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'text', text: 'Hello front' },
        ],
      },
      { type: 'text_delta', delta: 'lo' },
    )
    assert.equal(stream.text, 'Hello front')
    assert.equal(stream.thinking, 'plan')
  })

  it('falls back to text_delta when partial has no text yet', () => {
    const stream = assistantStreamDeltaFromMessageUpdate(
      { role: 'assistant', content: [] },
      { type: 'text_delta', delta: 'first' },
    )
    assert.equal(stream.text, 'first')
  })

  it('falls back to text_end content', () => {
    const stream = assistantStreamDeltaFromMessageUpdate(
      { role: 'assistant', content: [] },
      { type: 'text_end', content: 'block complete' },
    )
    assert.equal(stream.text, 'block complete')
  })

  it('does not treat toolcall_delta as assistant text', () => {
    const stream = assistantStreamDeltaFromMessageUpdate(
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Looking at files.' }],
      },
      { type: 'toolcall_delta', delta: '{"path":"src/foo.ts"' },
    )
    assert.equal(stream.text, 'Looking at files.')
  })
})

describe('mergeStreamChunk with cumulative snapshots', () => {
  it('replaces with longer cumulative prefix', () => {
    assert.equal(mergeStreamChunk('Hel', 'Hello world'), 'Hello world')
  })

  it('does not shrink when duplicate cumulative arrives', () => {
    assert.equal(mergeStreamChunk('Hello', 'Hello'), 'Hello')
  })
})

describe('extractThinkingFromPiMessage', () => {
  it('joins thinking blocks', () => {
    assert.equal(
      extractThinkingFromPiMessage({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'a' },
          { type: 'text', text: 'x' },
          { type: 'thinking', thinking: 'b' },
        ],
      }),
      'ab',
    )
  })
})