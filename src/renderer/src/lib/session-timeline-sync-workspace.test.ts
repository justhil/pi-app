import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => mocks.invoke(...args) ?? Promise.resolve({}),
  },
}))

import { prependOlderTimelinePage } from './timeline-history-prepend'

describe('session timeline history prepend', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ items: [], sourceCount: 0, totalCount: 0 })
    useUIStore.setState({
      currentWorkspace: '/workspace/current',
      historyLoadedCount: 0,
      historyTotalCount: 0,
      timelineItems: [],
    })
  })

  it('passes the current workspace when prepending history', async () => {
    await prependOlderTimelinePage('/sessions/history.jsonl', 80, 40)

    expect(mocks.invoke).toHaveBeenCalledWith('session.getMessages', {
      sessionFile: '/sessions/history.jsonl',
      workspaceId: '/workspace/current',
      offset: 80,
      limit: 40,
    })
  })

  it.each([false, true])('preserves a new prompt and streaming reply while loading older history (persisted: %s)', async (persisted) => {
    const older: TimelineItem = {
      id: 'hist-older', type: 'user-message', text: 'Earlier request', timestamp: 1,
      sessionEntryId: 'older-user',
    }
    let resolve!: (page: { items: TimelineItem[]; sourceCount: number; totalCount: number }) => void
    mocks.invoke.mockReturnValue(new Promise((done) => { resolve = done }))
    useUIStore.setState({ historyLoadedCount: 2, historyTotalCount: 3 })
    const request = prependOlderTimelinePage('/sessions/history.jsonl', 2)

    // This turn arrives while the older page is in flight. Persisting a prompt keeps its opt ID.
    const current: TimelineItem[] = [
      {
        id: 'opt-user-new', type: 'user-message', text: 'Continue the checks', timestamp: 2,
        ...(persisted ? { sessionEntryId: 'new-user' } : {}),
      },
      {
        id: 'opt-asst-new', type: 'assistant-message', text: 'Checking the result', timestamp: 3,
        thinkingText: 'Reviewing the checks',
      },
    ]
    useUIStore.setState({
      timelineItems: current,
      streamingAssistantId: 'opt-asst-new',
      optimisticPendingUserText: persisted ? null : 'Continue the checks',
    })
    resolve({ items: [older], sourceCount: 1, totalCount: 3 })
    await request

    expect(useUIStore.getState().timelineItems).toEqual([older, ...current])
    expect(useUIStore.getState().streamingAssistantId).toBe('opt-asst-new')
    expect(useUIStore.getState().optimisticPendingUserText).toBe(persisted ? null : 'Continue the checks')
    expect(useUIStore.getState().historyLoadedCount).toBe(3)
    expect(useUIStore.getState().historyTotalCount).toBe(3)
  })
})
