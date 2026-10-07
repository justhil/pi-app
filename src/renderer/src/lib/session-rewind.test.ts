import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GetMessagesResult } from './session-history'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn(), disk: vi.fn(), meta: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/session-history', () => ({
  fetchSessionHistoryTail: mocks.fetch, getSessionMessagesFromDiskViaIpc: mocks.disk, clearSessionHistoryCache: vi.fn(),
}))
vi.mock('@renderer/lib/session-shell', () => ({ captureFocusFromUiStore: vi.fn() }))
vi.mock('@renderer/lib/live-session-timeline-cache', () => ({ clearLiveSessionTimeline: vi.fn() }))
vi.mock('@renderer/lib/session-display-meta', () => ({ applyComposerDisplayMeta: mocks.meta }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn() }))
vi.mock('@renderer/lib/subagent-session-preview', () => ({ isCurrentSubagentSessionPreview: () => false }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

import { navigateSessionToEntry } from './session-rewind'
import { beginSessionNavigation } from './session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const history: GetMessagesResult = {
  items: [{ id: 'rewound-a', type: 'user-message', text: 'Rewound A', timestamp: 1 }], sourceCount: 1, totalCount: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  beginSessionNavigation()
  mocks.invoke.mockResolvedValue({ leafId: 'leaf-a' })
  mocks.fetch.mockResolvedValue(history)
  mocks.disk.mockResolvedValue(history)
  mocks.meta.mockResolvedValue(undefined)
  useUIStore.setState({
    currentSessionId: 'a', historySessionFile: '/sessions/a.jsonl',
    timelineItems: [{ id: 'a', type: 'user-message', text: 'Session A', timestamp: 2 }],
    historyLoadedCount: 1, historyTotalCount: 2, historyLoading: false,
    runState: { status: 'idle', toolCount: 0, errorCount: 0 }, sessionRuntimeRunning: {},
    optimisticPendingUserText: null, streamingAssistantId: null, agentTurnBootstrapping: false,
    workerLiveSnapshot: { sessionId: 'a', sessionFile: '/sessions/a.jsonl', status: 'idle' },
  })
})

function switchToB() {
  beginSessionNavigation()
  useUIStore.setState({ currentSessionId: 'b', historySessionFile: '/sessions/b.jsonl',
    timelineItems: [{ id: 'b', type: 'user-message', text: 'Session B', timestamp: 3 }],
    historyLoadedCount: 2, historyTotalCount: 5, historyLoading: true,
    workerLiveSnapshot: { sessionId: 'b', sessionFile: '/sessions/b.jsonl', status: 'running' },
  })
  return useUIStore.getState()
}

describe('rewind history session isolation', () => {
  it.each(['navigation', 'history', 'fallback'] as const)('ignores a late %s response after switching to B', async (phase) => {
    const pending = deferred<GetMessagesResult & { leafId?: string }>()
    if (phase === 'navigation') mocks.invoke.mockReturnValue(pending.promise)
    else if (phase === 'history') mocks.fetch.mockReturnValue(pending.promise)
    else {
      mocks.fetch.mockResolvedValue({ ...history, items: [], error: 'retry disk' })
      mocks.disk.mockReturnValue(pending.promise)
    }
    const request = navigateSessionToEntry('entry-a')
    await vi.waitFor(() => expect(phase === 'navigation' ? mocks.invoke : phase === 'history' ? mocks.fetch : mocks.disk).toHaveBeenCalled())
    const next = switchToB()
    pending.resolve({ ...history, leafId: 'leaf-a' })
    expect(await request).toBe(false)
    const current = useUIStore.getState()
    expect(current.timelineItems).toEqual(next.timelineItems)
    expect(current.historySessionFile).toBe('/sessions/b.jsonl')
    expect(current.workerLiveSnapshot).toEqual(next.workerLiveSnapshot)
    expect(current.historyLoadedCount).toBe(2)
    expect(current.historyTotalCount).toBe(5)
    expect(current.historyLoading).toBe(true)
    expect(mocks.meta).not.toHaveBeenCalled()
  })

  it('keeps ordinary rewind working in the current session', async () => {
    expect(await navigateSessionToEntry('entry-a')).toBe(true)
    expect(useUIStore.getState().timelineItems.map((item) => item.text)).toEqual(['Rewound A'])
    expect(useUIStore.getState().historySessionFile).toBe('/sessions/a.jsonl')
    expect(mocks.meta).toHaveBeenCalledOnce()
  })
})
