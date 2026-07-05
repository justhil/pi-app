import { describe, expect, it } from 'vitest'
import { isLiveSessionTurnActive, mergeLiveViewRunState } from '../live-session-restore'
import type { LiveSessionTimelineSnapshot } from '../live-session-timeline-cache'

const file = '/tmp/run.jsonl'

function live(partial: Partial<LiveSessionTimelineSnapshot>): LiveSessionTimelineSnapshot {
  return {
    sessionId: 's1',
    sessionFile: file,
    timelineItems: [],
    streamingAssistantId: null,
    runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    pendingSteering: [],
    pendingFollowUp: [],
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    ...partial,
  }
}

describe('live-session-restore', () => {
  it('treats live turn active when worker still running on same file but cache runState is idle', () => {
    const snap = live({ runState: { status: 'idle', toolCount: 0, errorCount: 0 } })
    expect(
      isLiveSessionTurnActive(file, snap, {
        sessionId: 's1',
        sessionFile: file,
        status: 'running',
      }),
    ).toBe(true)
  })

  it('mergeLiveViewRunState forces running when worker snapshot is running', () => {
    const snap = live({
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      streamingAssistantId: 'a1',
    })
    const rs = mergeLiveViewRunState(file, snap, {
      sessionId: 's1',
      sessionFile: file,
      status: 'running',
    })
    expect(rs.status).toBe('running')
  })

  it('mergeLiveViewRunState keeps streaming turn running when cache still has streamingAssistantId', () => {
    const snap = live({
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      streamingAssistantId: 'stream-1',
    })
    const rs = mergeLiveViewRunState(file, snap, {
      sessionId: 's1',
      sessionFile: file,
      status: 'idle',
    })
    expect(rs.status).toBe('running')
  })
})