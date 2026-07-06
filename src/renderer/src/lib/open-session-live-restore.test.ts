import { describe, expect, it } from 'vitest'
import { mergeLiveActiveSessionDisplay } from './open-session-live-restore'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

describe('mergeLiveActiveSessionDisplay', () => {
  it('merges authoritative disk tail with live cache and projects', () => {
    const diskItems: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'hi', timestamp: 1 },
      { id: 'a1', type: 'assistant-message', text: 'old', timestamp: 2 },
    ]
    const liveItems: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'hi', timestamp: 1 },
      { id: 'a2', type: 'assistant-message', text: 'live', runId: 'r1', timestamp: 3 },
    ]
    const { displayed } = mergeLiveActiveSessionDisplay({
      diskItems,
      live: {
        sessionId: 's1',
        sessionFile: '/f.jsonl',
        timelineItems: liveItems,
        streamingAssistantId: 'a2',
        runState: { status: 'running', toolCount: 0, errorCount: 0 },
        pendingSteering: [],
        pendingFollowUp: [],
        optimisticPendingUserText: null,
        agentTurnBootstrapping: false,
      },
      totalCount: 50,
      cursor: { totalCount: 50, loadedOffsetFromEnd: 2, loadedThroughEntryId: null },
    })
    expect(displayed.some((i) => i.type === 'assistant-message' && i.text?.includes('live'))).toBe(true)
  })
})