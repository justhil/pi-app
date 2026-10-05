import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GetMessagesResult } from '../session-history'

const mocks = vi.hoisted(() => ({
  history: vi.fn(), list: vi.fn(), meta: vi.fn(),
  tree: vi.fn(), anchor: vi.fn(), capture: vi.fn(), clearLive: vi.fn(),
}))
vi.mock('@renderer/lib/load-session-history', () => ({ loadSessionHistoryWithRetry: mocks.history }))
vi.mock('@renderer/lib/refresh-workspace-session-lists', () => ({ refreshWorkspaceSessionLists: mocks.list }))
vi.mock('@renderer/lib/session-display-meta', () => ({ applyComposerDisplayMeta: mocks.meta }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: mocks.tree }))
vi.mock('@renderer/features/timeline/timeline-bottom-anchor', () => ({ requestTimelineBottomAnchor: mocks.anchor }))
vi.mock('@renderer/lib/session-shell', () => ({ captureFocusFromUiStore: mocks.capture }))
vi.mock('@renderer/lib/live-session-timeline-cache', () => ({ clearLiveSessionTimeline: mocks.clearLive }))

import { reloadCurrentSessionData } from '../reload-current-session-data'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearStreamPending } from '@renderer/stores/ui-store-stream'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const history: GetMessagesResult = {
  items: [{ id: 'fresh', type: 'user-message', text: 'fresh history', timestamp: 2 }],
  sourceCount: 1, totalCount: 1,
}

describe('current session reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStreamPending()
    mocks.history.mockResolvedValue(history)
    mocks.list.mockResolvedValue(undefined)
    mocks.meta.mockResolvedValue(undefined)
    mocks.tree.mockResolvedValue(undefined)
    useUIStore.setState({
      currentWorkspace: '/workspace', currentSessionId: 'a',
      historySessionFile: '/workspace/a.jsonl', historyLoading: false,
      timelineItems: [{ id: 'old', type: 'user-message', text: 'old history', timestamp: 1 }],
      streamingAssistantId: null, optimisticPendingUserText: null, agentTurnBootstrapping: false,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
  })

  afterEach(() => { clearStreamPending() })

  it('should_refresh_messages_when_sidebar_listing_is_still_pending', async () => {
    const list = deferred<void>()
    mocks.list.mockReturnValue(list.promise)
    const reload = reloadCurrentSessionData()
    try {
      await vi.waitFor(() => expect(mocks.history).toHaveBeenCalled(), { timeout: 100 })
      await reload
      expect(useUIStore.getState().timelineItems[0]?.text).toBe('fresh history')
    } finally {
      list.resolve()
      await reload
    }
  })

  it('should_not_rebind_worker_when_only_refreshing_displayed_messages', async () => {
    await reloadCurrentSessionData()
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.clearLive).toHaveBeenCalledWith('/workspace/a.jsonl')
  })

  it('preserves live cache while the refreshed session is still running', async () => {
    useUIStore.setState({ sessionRuntimeRunning: { '/workspace/a.jsonl': true } })
    await reloadCurrentSessionData()
    expect(useUIStore.getState().runState.status).toBe('running')
    expect(mocks.clearLive).not.toHaveBeenCalled()
  })

  it('should_not_overwrite_new_session_when_old_reload_finishes', async () => {
    const pending = deferred<GetMessagesResult>()
    mocks.history.mockReturnValue(pending.promise)
    const reload = reloadCurrentSessionData()
    await vi.waitFor(() => expect(mocks.history).toHaveBeenCalled())
    const nextItems = [{ id: 'b', type: 'user-message' as const, text: 'session B', timestamp: 3 }]
    useUIStore.setState({
      currentSessionId: 'b', historySessionFile: '/workspace/b.jsonl',
      timelineItems: nextItems, historyLoading: true,
    })
    pending.resolve(history)
    await reload
    expect(useUIStore.getState().historySessionFile).toBe('/workspace/b.jsonl')
    expect(useUIStore.getState().timelineItems).toEqual(nextItems)
    expect(useUIStore.getState().historyLoading).toBe(true)
    expect(mocks.meta).not.toHaveBeenCalled()
    expect(mocks.anchor).not.toHaveBeenCalled()
    expect(mocks.clearLive).not.toHaveBeenCalled()
  })

  it('should_keep_newer_reload_when_older_request_finishes_last', async () => {
    const older = deferred<GetMessagesResult>()
    mocks.history.mockReturnValueOnce(older.promise)
    const first = reloadCurrentSessionData()
    await vi.waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1))
    await reloadCurrentSessionData()
    older.resolve({
      ...history, items: [{ id: 'stale', type: 'user-message', text: 'stale history', timestamp: 0 }],
    })
    await first
    expect(useUIStore.getState().timelineItems[0]?.text).toBe('fresh history')
  })

  it('should_keep_current_messages_when_disk_read_returns_error', async () => {
    mocks.history.mockResolvedValue({ items: [], sourceCount: 0, totalCount: 0, error: 'read failed' })
    const result = await reloadCurrentSessionData()
    expect(result).toEqual({ ok: false, error: 'read failed' })
    expect(useUIStore.getState().timelineItems[0]?.text).toBe('old history')
    expect(useUIStore.getState().historyLoading).toBe(false)
    expect(mocks.clearLive).not.toHaveBeenCalled()
  })
})
