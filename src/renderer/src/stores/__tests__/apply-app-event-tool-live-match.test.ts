import { describe, it, expect } from 'vitest'
import { findLiveToolRowByCallId, handleTool } from '../apply-app-event-tool'
import type { StoreApi } from '../apply-app-event-types'
import type { TimelineItem } from '../ui-store-types'

describe('live tool match by toolCallId only', () => {
  it('findLiveToolRowByCallId ignores name and matches call id', () => {
    const items = [
      { id: '1', type: 'tool-call', toolCallId: 'a', toolName: 'bash' },
      { id: '2', type: 'tool-call', toolCallId: 'b', toolName: 'bash' },
    ]
    expect(findLiveToolRowByCallId(items, 'a')?.id).toBe('1')
    expect(findLiveToolRowByCallId(items, 'b')?.id).toBe('2')
    expect(findLiveToolRowByCallId(items, 'missing')).toBeUndefined()
    expect(findLiveToolRowByCallId(items, undefined)).toBeUndefined()
  })

  it('parallel same-name tools update/end each own row', () => {
    const timelineItems: TimelineItem[] = [
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'bash',
        toolPhase: 'start',
        timestamp: 1,
      },
      {
        id: 't2',
        type: 'tool-call',
        toolCallId: 'tc2',
        toolName: 'bash',
        toolPhase: 'start',
        timestamp: 2,
      },
    ]
    let toolCount = 0
    const api = {
      get: () => ({
        timelineItems,
        streamingAssistantId: null,
        runState: { status: 'running' as const, toolCount, errorCount: 0 },
        appendTimeline: () => {},
        insertTimelineBefore: () => {},
        updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => {
          const idx = timelineItems.findIndex((i) => i.id === id)
          if (idx >= 0) timelineItems[idx] = { ...timelineItems[idx], ...patch }
        },
        setRunState: (p: { toolCount?: number }) => {
          if (p.toolCount != null) toolCount = p.toolCount
        },
      }),
      set: () => {},
      nextItemId: () => 'x',
    } as unknown as StoreApi

    handleTool(
      {
        type: 'tool',
        phase: 'end',
        toolCallId: 'tc1',
        toolName: 'bash',
        output: 'out-1',
        isError: false,
        runId: 'r1',
        timestamp: 3,
        sessionId: 's',
        workspaceId: 'w',
        seq: 1,
      },
      api,
    )
    expect(timelineItems[0].toolPhase).toBe('end')
    expect(timelineItems[0].toolOutput).toBe('out-1')
    expect(timelineItems[1].toolPhase).toBe('start')

    handleTool(
      {
        type: 'tool',
        phase: 'end',
        toolCallId: 'tc2',
        toolName: 'bash',
        output: 'out-2',
        isError: false,
        runId: 'r1',
        timestamp: 4,
        sessionId: 's',
        workspaceId: 'w',
        seq: 2,
      },
      api,
    )
    expect(timelineItems[1].toolPhase).toBe('end')
    expect(timelineItems[1].toolOutput).toBe('out-2')
  })

  it('does not name-fallback when toolCallId missing/unknown', () => {
    const timelineItems: TimelineItem[] = [
      {
        id: 't1',
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'bash',
        toolPhase: 'start',
        timestamp: 1,
      },
    ]
    const api = {
      get: () => ({
        timelineItems,
        streamingAssistantId: null,
        runState: { status: 'running' as const, toolCount: 0, errorCount: 0 },
        appendTimeline: () => {},
        insertTimelineBefore: () => {},
        updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => {
          const idx = timelineItems.findIndex((i) => i.id === id)
          if (idx >= 0) timelineItems[idx] = { ...timelineItems[idx], ...patch }
        },
        setRunState: () => {},
      }),
      set: () => {},
      nextItemId: () => 'x',
    } as unknown as StoreApi

    handleTool(
      {
        type: 'tool',
        phase: 'end',
        toolCallId: 'other',
        toolName: 'bash',
        output: 'should-not-apply',
        isError: false,
        runId: 'r1',
        timestamp: 3,
        sessionId: 's',
        workspaceId: 'w',
        seq: 1,
      },
      api,
    )
    expect(timelineItems[0].toolPhase).toBe('start')
    expect(timelineItems[0].toolOutput).toBeUndefined()
  })
})
