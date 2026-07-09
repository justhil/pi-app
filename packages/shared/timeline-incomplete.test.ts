import { describe, it, expect } from 'vitest'
import {
  markTrailingIncompleteAssistants,
  resolveRewindTargetEntryId,
  type IncompleteTimelineRow,
} from './timeline-incomplete'

describe('markTrailingIncompleteAssistants', () => {
  it('marks empty trailing assistant as incomplete', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'hi', sessionEntryId: 'user-1' },
      { id: 'a1', type: 'assistant-message', text: '', sessionEntryId: 'asst-1' },
    ]
    const out = markTrailingIncompleteAssistants(items)
    expect(out[1].incomplete).toBe(true)
    expect(out[1].stopReason).toBe('interrupted')
  })

  it('does not mark completed assistant with body', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'hi', sessionEntryId: 'user-1' },
      { id: 'a1', type: 'assistant-message', text: 'hello', sessionEntryId: 'asst-1' },
    ]
    const out = markTrailingIncompleteAssistants(items)
    expect(out[1].incomplete).toBeUndefined()
  })
})

describe('resolveRewindTargetEntryId', () => {
  it('rewinds empty incomplete assistant to previous user', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'q', sessionEntryId: 'user-1' },
      {
        id: 'a1',
        type: 'assistant-message',
        text: '',
        sessionEntryId: 'asst-empty',
        incomplete: true,
        stopReason: 'interrupted',
      },
    ]
    expect(resolveRewindTargetEntryId(items, items[1])).toBe('user-1')
  })

  it('keeps own id for normal assistant', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'q', sessionEntryId: 'user-1' },
      { id: 'a1', type: 'assistant-message', text: 'ok', sessionEntryId: 'asst-1' },
    ]
    expect(resolveRewindTargetEntryId(items, items[1])).toBe('asst-1')
  })
})
