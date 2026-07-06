import { describe, expect, it } from 'vitest'
import { lastSessionEntryId } from './session-timeline-sync'

describe('lastSessionEntryId', () => {
  it('returns last item with sessionEntryId', () => {
    expect(
      lastSessionEntryId([
        { id: '1', type: 'user-message', timestamp: 1 },
        { id: '2', type: 'assistant-message', sessionEntryId: 'e2', timestamp: 2 },
      ]),
    ).toBe('e2')
  })
})