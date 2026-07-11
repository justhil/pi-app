import { describe, it, expect } from 'vitest'
import {
  markTrailingIncompleteAssistants,
  resolveRewindTargetEntryId,
  isToolBridgeEmptyAssistant,
  isInterruptedAssistantRow,
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

  it('does not mark empty tool-bridge assistants mid-turn', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'go', sessionEntryId: 'user-1' },
      { id: 'a1', type: 'assistant-message', text: '', sessionEntryId: 'asst-bridge' },
      { id: 't1', type: 'tool-call' },
      { id: 'a2', type: 'assistant-message', text: '', sessionEntryId: 'asst-bridge-2' },
      { id: 't2', type: 'tool-call' },
      { id: 'a3', type: 'assistant-message', text: 'done', sessionEntryId: 'asst-final' },
    ]
    const out = markTrailingIncompleteAssistants(items)
    expect(out[1].incomplete).toBeUndefined()
    expect(out[3].incomplete).toBeUndefined()
    expect(out[5].incomplete).toBeUndefined()
  })

  it('clears false incomplete on tool-bridge rows', () => {
    const items: IncompleteTimelineRow[] = [
      { id: 'u1', type: 'user-message', text: 'go', sessionEntryId: 'user-1' },
      {
        id: 'a1',
        type: 'assistant-message',
        text: '',
        sessionEntryId: 'asst-bridge',
        incomplete: true,
        stopReason: 'interrupted',
      },
      { id: 't1', type: 'tool-call' },
      { id: 'a2', type: 'assistant-message', text: 'ok', sessionEntryId: 'asst-final' },
    ]
    const out = markTrailingIncompleteAssistants(items)
    expect(out[1].incomplete).toBeUndefined()
    expect(isToolBridgeEmptyAssistant(out, 1)).toBe(true)
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

describe('isInterruptedAssistantRow', () => {
  it('empty body alone is not interrupted', () => {
    expect(
      isInterruptedAssistantRow({ type: 'assistant-message', text: '', sessionEntryId: 'x' }),
    ).toBe(false)
  })

  it('incomplete flag is interrupted', () => {
    expect(
      isInterruptedAssistantRow({
        type: 'assistant-message',
        text: '',
        incomplete: true,
        stopReason: 'interrupted',
      }),
    ).toBe(true)
  })
})
