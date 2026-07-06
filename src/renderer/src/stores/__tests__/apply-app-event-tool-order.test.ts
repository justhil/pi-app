import { describe, it, expect } from 'vitest'
import { handleTool } from '../apply-app-event-tool'
import type { StoreApi } from '../apply-app-event-types'
import type { TimelineItem } from '../ui-store-types'

describe('handleTool start order', () => {
  it('inserts tool before empty streaming assistant bubble', () => {
    const timelineItems: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'hi', timestamp: 1 },
      { id: 'a1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 2 },
    ]
    let streamingAssistantId: string | null = 'a1'
    let seq = 0

    const api = {
      get: () => ({
        timelineItems,
        streamingAssistantId,
        runState: { status: 'running' as const, toolCount: 0, errorCount: 0 },
        appendTimeline: (item: TimelineItem) => {
          timelineItems.push(item)
        },
        insertTimelineBefore: (beforeId: string, item: TimelineItem) => {
          const idx = timelineItems.findIndex((i) => i.id === beforeId)
          if (idx < 0) timelineItems.push(item)
          else timelineItems.splice(idx, 0, item)
        },
        updateTimelineItem: () => {},
        setRunState: () => {},
      }),
      set: (p: { streamingAssistantId?: string | null }) => {
        if (p.streamingAssistantId !== undefined) streamingAssistantId = p.streamingAssistantId
      },
      nextItemId: () => `gen-${++seq}`,
    }

    handleTool(
      {
        type: 'tool',
        phase: 'start',
        toolCallId: 'tc1',
        toolName: 'read',
        input: {},
        runId: 'r1',
        timestamp: 3,
        sessionId: 's',
        workspaceId: 'w',
        seq: 1,
      },
      api as unknown as StoreApi,
    )

    expect(timelineItems.map((i) => `${i.type}:${i.id}`)).toEqual([
      'user-message:u1',
      'tool-call:gen-1',
      'assistant-message:a1',
    ])
    expect(streamingAssistantId).toBe('a1')
  })
})