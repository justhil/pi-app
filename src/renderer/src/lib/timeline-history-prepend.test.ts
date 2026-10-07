import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPage } from './session-timeline-sync'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({}) } }))
vi.mock('@renderer/lib/session-timeline-sync', () => ({ fetchTimelineHistoryPage: mocks.fetch }))

import { prependOlderTimelinePage } from './timeline-history-prepend'
import { beginSessionNavigation } from './session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'

const file = '/sessions/a.jsonl'
const older: HistoryPage = {
  items: [{ id: 'older-a', type: 'user-message', text: 'Earlier message in A', timestamp: 1 }],
  sourceCount: 1,
  totalCount: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  beginSessionNavigation()
  useUIStore.setState({
    currentSessionId: 'a', historySessionFile: file,
    historyLoadedCount: 1, historyTotalCount: 3,
    timelineItems: [{ id: 'a', type: 'user-message', text: 'Session A', timestamp: 2 }],
  })
  mocks.fetch.mockResolvedValue(older)
})

describe('older history belongs to its requested session', () => {
  it.each([true, false])('does not append A history or change B counts after switching sessions (navigation=%s)', async (navigation) => {
    let resolve!: (page: HistoryPage) => void
    mocks.fetch.mockReturnValue(new Promise<HistoryPage>((done) => { resolve = done }))
    const request = prependOlderTimelinePage(file, 1)
    if (navigation) beginSessionNavigation()
    const nextItems = [{ id: 'b', type: 'user-message' as const, text: 'Session B', timestamp: 3 }]
    useUIStore.setState({ currentSessionId: 'b', historySessionFile: '/sessions/b.jsonl',
      timelineItems: nextItems, historyLoadedCount: 2, historyTotalCount: 5 })
    resolve(older)
    const result = await request
    expect(useUIStore.getState().timelineItems).toEqual(nextItems)
    expect(useUIStore.getState().historyLoadedCount).toBe(2)
    expect(useUIStore.getState().historyTotalCount).toBe(5)
    expect(result.cancelled).toBe(true)
  })

  it('discards an older request even after leaving and returning to A', async () => {
    let resolve!: (page: HistoryPage) => void
    mocks.fetch.mockReturnValue(new Promise<HistoryPage>((done) => { resolve = done }))
    const request = prependOlderTimelinePage(file, 1)
    beginSessionNavigation()
    beginSessionNavigation()
    resolve(older)
    expect((await request).cancelled).toBe(true)
    expect(useUIStore.getState().timelineItems.map((item) => item.id)).toEqual(['a'])
    expect(useUIStore.getState().historyLoadedCount).toBe(1)
  })

  it('prepends the page when the same normalized session is still visible', async () => {
    useUIStore.setState({ historySessionFile: 'C:\\sessions\\a.jsonl' })
    await prependOlderTimelinePage('c:/sessions/a.jsonl', 1)
    expect(useUIStore.getState().timelineItems.map((item) => item.text)).toEqual(['Earlier message in A', 'Session A'])
    expect(useUIStore.getState().historyLoadedCount).toBe(2)
  })
})
