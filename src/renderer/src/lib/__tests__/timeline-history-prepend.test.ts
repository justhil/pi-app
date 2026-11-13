import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const fetchOlderMock = vi.hoisted(() => vi.fn())
const fetchTailMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))
vi.mock('@renderer/lib/session-timeline-sync', () => ({
  fetchTimelineHistoryPage: fetchOlderMock,
}))
vi.mock('@renderer/lib/session-history', () => ({
  SESSION_HISTORY_PAGE: 80,
  fetchSessionHistoryTail: fetchTailMock,
}))
vi.mock('@renderer/lib/session-display-meta', () => ({
  applyComposerDisplayMeta: vi.fn().mockResolvedValue(undefined),
}))

import { mergePrependedHistoryItems, isReusableOptimisticUserMessage, dedupeAdjacentUserMessages } from '../timeline-dedupe'
import { prependOlderTimelinePage } from '../timeline-history-prepend'
import { clearSessionShellForTests, focusSessionSync, hydrateSessionView } from '../session-shell'
import { beginSessionNavigation } from '../session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('timeline dedupe and prepend guard', () => {
  beforeEach(() => {
    clearSessionShellForTests()
    beginSessionNavigation()
    fetchOlderMock.mockReset()
    fetchTailMock.mockReset()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 's1',
      historySessionFile: '/sessions/s1.jsonl',
      historyLoading: false,
      historyTotalCount: 0,
      historyLoadedCount: 0,
      timelineItems: [],
      sessionRuntimeRunning: {},
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 's1', sessionFile: '/sessions/s1.jsonl', status: 'idle' },
    })
  })

  it('matches optimistic user message with attachment payloadText against worker echo', () => {
    const optItem: TimelineItem = {
      id: 'opt-user-1',
      type: 'user-message',
      text: 'check this file',
      payloadText: 'check this file /workspace/src/main.ts',
      segments: [
        { type: 'text', text: 'check this file ' },
        { type: 'file', attachment: { path: '/workspace/src/main.ts', name: 'main.ts', kind: 'code' } },
      ],
      timestamp: 1,
    }
    expect(
      isReusableOptimisticUserMessage(optItem, 'check this file /workspace/src/main.ts', null),
    ).toBe(true)

    const merged = dedupeAdjacentUserMessages([
      optItem,
      {
        id: 'live-user-echo',
        type: 'user-message',
        text: 'check this file /workspace/src/main.ts',
        sessionEntryId: 'entry-u1',
        timestamp: 2,
      },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      sessionEntryId: 'entry-u1',
      text: 'check this file',
      payloadText: 'check this file /workspace/src/main.ts',
    })
    expect(merged[0]?.segments).toHaveLength(2)
  })

  it('deduplicates overlapping persisted rows when prepending older history pages', () => {
    const current: TimelineItem[] = [
      { id: 'tail-u2', type: 'user-message', text: 'second', sessionEntryId: 'u2', timestamp: 3 },
      { id: 'tail-a2', type: 'assistant-message', text: 'second ans', sessionEntryId: 'a2', timestamp: 4 },
    ]
    const olderPage: TimelineItem[] = [
      { id: 'old-u1', type: 'user-message', text: 'first', sessionEntryId: 'u1', timestamp: 1 },
      { id: 'old-a1', type: 'assistant-message', text: 'first ans', sessionEntryId: 'a1', timestamp: 2 },
      // Overlapping turn from offset boundary
      { id: 'old-u2-dup', type: 'user-message', text: 'second', sessionEntryId: 'u2', timestamp: 3 },
      { id: 'old-a2-dup', type: 'assistant-message', text: 'second ans', sessionEntryId: 'a2', timestamp: 4 },
    ]
    const res = mergePrependedHistoryItems(olderPage, current)
    expect(res.addedCount).toBe(2)
    expect(res.items.map((r) => r.sessionEntryId)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('waits for in-flight hydrate and skips stale overlapping prepend on cached instant switch', async () => {
    const sessionFile = '/sessions/cached.jsonl'
    useUIStore.setState({
      currentSessionId: 'cached',
      historySessionFile: sessionFile,
      historyTotalCount: 4,
      historyLoadedCount: 2,
      timelineItems: [
        { id: 'u3', type: 'user-message', text: 'q3', sessionEntryId: 'e3', timestamp: 3 },
        { id: 'a3', type: 'assistant-message', text: 'a3', sessionEntryId: 'e4', timestamp: 4 },
      ],
    })
    focusSessionSync('cached', sessionFile)

    const hydrateRes = deferred<{
      items: TimelineItem[]
      sourceCount: number
      totalCount: number
    }>()
    fetchTailMock.mockReturnValueOnce(hydrateRes.promise)
    const hydrating = hydrateSessionView(sessionFile, 'cached')

    const prepending = prependOlderTimelinePage(sessionFile, 2, 80)

    hydrateRes.resolve({
      items: [
        { id: 'd1', type: 'user-message', text: 'q1', sessionEntryId: 'e1', timestamp: 1 },
        { id: 'd2', type: 'assistant-message', text: 'a1', sessionEntryId: 'e2', timestamp: 2 },
        { id: 'd3', type: 'user-message', text: 'q3', sessionEntryId: 'e3', timestamp: 3 },
        { id: 'd4', type: 'assistant-message', text: 'a3', sessionEntryId: 'e4', timestamp: 4 },
      ],
      sourceCount: 4,
      totalCount: 4,
    })

    await hydrating
    const prependResult = await prepending
    expect(fetchOlderMock).not.toHaveBeenCalled()
    expect(prependResult.items).toEqual([])
    expect(useUIStore.getState().timelineItems.map((i) => i.sessionEntryId)).toEqual(['e1', 'e2', 'e3', 'e4'])
  })
})
