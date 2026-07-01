import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStreamChunk } from '../../packages/shared/stream-merge.ts'
import { formatSessionModelKey } from '../../packages/shared/worker-model.ts'
import { isSessionScopedAppEvent } from '../../packages/shared/app-event-session.ts'
import { extractTextFromPiMessage } from '../../packages/shared/worker-message.ts'

describe('@shared package smoke', () => {
  it('imports core boundary modules', () => {
    assert.equal(mergeStreamChunk('a', 'b'), 'ab')
    assert.equal(formatSessionModelKey({ provider: 'p', modelId: 'm' }), 'p/m')
    assert.equal(isSessionScopedAppEvent({ type: 'run', phase: 'idle', sessionId: 's' }), true)
    assert.equal(extractTextFromPiMessage({ content: [{ type: 'text', text: 'x' }] }), 'x')
  })
})