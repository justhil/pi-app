import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  clearSessionShellForTests,
  focusSessionSync,
  hydrateSessionView,
} from '@renderer/lib/session-shell'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
}))

const message = (idx: number, role: 'user' | 'assistant'): TimelineItem =>
  ({
    id: `item-${idx}`,
    type: role === 'user' ? 'user-message' : 'assistant-message',
    text: `message-${idx}`,
    timestamp: idx * 1000,
    sessionEntryId: `entry-${idx}`,
  }) as TimelineItem

function diskChunk(from: number, to: number): TimelineItem[] {
  const out: TimelineItem[] = []
  for (let i = from; i <= to; i++) out.push(message(i, i % 2 === 0 ? 'user' : 'assistant'))
  return out
}

const SESSION = '/tmp/proj/s.jsonl'
const TOTAL = 60
const TAIL_START = 40

beforeEach(() => {
  clearSessionShellForTests()
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: null,
    timelineItems: [],
    historyTotalCount: 0,
    historyLoadedCount: 0,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle' } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
  })
  vi.mocked(ipcClient.invoke).mockClear()
})

/**
 * Regression: the session-shell hydrate must not clobber a store that a
 * view-jump reveal already extended to the top of the session. Before the fix,
 * a late hydrate bind replaced the fully-loaded store with the 80-item tail and
 * reset historyLoadedCount — undoing the reveal ("切过去之后，又被切走").
 */
describe('session-shell hydrate vs view-jump reveal', () => {
  it('preserves a fully-loaded store when the hydrate tail lands late', async () => {
    // The reveal already prepended [1..60] and pinned historyLoadedCount.
    useUIStore.setState({
      historySessionFile: SESSION,
      timelineItems: diskChunk(1, TOTAL),
      historyTotalCount: TOTAL,
      historyLoadedCount: TOTAL,
    })

    // The disk tail the hydrate will fetch.
    vi.mocked(ipcClient.invoke).mockImplementation(((name: string) => {
      if (name === 'session.getMessages') {
        return Promise.resolve({
          items: diskChunk(TAIL_START, TOTAL),
          totalCount: TOTAL,
          sourceCount: TOTAL - TAIL_START + 1,
        })
      }
      return Promise.resolve({ items: [], totalCount: 0, sourceCount: 0 })
    }) as never)

    focusSessionSync('s1', SESSION)
    await act(async () => {
      await hydrateSessionView(SESSION, 's1')
    })

    const st = useUIStore.getState()
    const ids = st.timelineItems.map((it) => Number((it.id as string).split('-')[1]))
    expect(ids).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1))
    expect(st.historyLoadedCount).toBe(TOTAL)
    expect(st.historyTotalCount).toBe(TOTAL)
  })

  it('hydrates an empty store normally (no regression)', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(((name: string) => {
      if (name === 'session.getMessages') {
        return Promise.resolve({
          items: diskChunk(TAIL_START, TOTAL),
          totalCount: TOTAL,
          sourceCount: TOTAL - TAIL_START + 1,
        })
      }
      return Promise.resolve({ items: [], totalCount: 0, sourceCount: 0 })
    }) as never)

    focusSessionSync('s1', SESSION)
    await act(async () => {
      await hydrateSessionView(SESSION, 's1')
    })

    const st = useUIStore.getState()
    const ids = st.timelineItems.map((it) => Number((it.id as string).split('-')[1]))
    expect(ids).toEqual(Array.from({ length: TOTAL - TAIL_START + 1 }, (_, i) => i + TAIL_START))
    expect(st.historyLoadedCount).toBe(TOTAL - TAIL_START + 1)
  })
})
