import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import { requestTimelineViewEntry } from './timeline-view-jump'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
}))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({
  reloadCurrentSessionData: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: false, showSpinner: false, sessionKey: '/tmp/proj/s.jsonl' }),
}))

const message = (idx: number, role: 'user' | 'assistant'): TimelineItem =>
  ({
    id: `item-${idx}`,
    type: role === 'user' ? 'user-message' : 'assistant-message',
    text: `message-${idx}`,
    timestamp: idx * 1000,
    sessionEntryId: `entry-${idx}`,
  }) as TimelineItem

const TOTAL = 60
const TAIL_START = 40

let scrollIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  const items: TimelineItem[] = []
  for (let i = 0; i < TOTAL; i++) items.push(message(i, i % 2 === 0 ? 'user' : 'assistant'))
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/s.jsonl',
    timelineItems: items.slice(TAIL_START),
    historyTotalCount: TOTAL,
    historyLoadedCount: TOTAL - TAIL_START,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle' } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
  })
  vi.mocked(ipcClient.invoke).mockClear()
  scrollIntoView = vi.fn()
  const orig = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = scrollIntoView as unknown as (arg?: boolean | ScrollIntoViewOptions) => void
  return () => {
    Element.prototype.scrollIntoView = orig
  }
})

describe('Timeline view-entry reveal', () => {
  it('expands the render window and scrolls to a loaded target outside it', async () => {
    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-45'))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const target = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(target?.dataset?.sessionEntryId).toBe('entry-45')
  })

  it('fetches missing history and reveals a target older than the loaded tail', async () => {
    const chunk: TimelineItem[] = [
      message(1, 'user'),
      message(2, 'assistant'),
      message(3, 'user'),
      message(4, 'assistant'),
      message(5, 'user'),
      message(6, 'assistant'),
    ]
    vi.mocked(ipcClient.invoke).mockResolvedValue({
      items: chunk,
      totalCount: TOTAL,
      sourceCount: chunk.length,
    } as never)

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(ipcClient.invoke).toHaveBeenCalledWith(
      'session.getMessages',
      expect.objectContaining({ leafId: 'entry-3' }),
    )
    const storeItems = useUIStore.getState().timelineItems
    expect(storeItems.some((it) => it.sessionEntryId === 'entry-3')).toBe(true)
    const target = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(target?.dataset?.sessionEntryId).toBe('entry-3')
  })

  it('does not jump when the user scrolled during a pending load', async () => {
    let resolveFetch: (v: { items: TimelineItem[]; totalCount: number; sourceCount: number }) => void
    vi.mocked(ipcClient.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }) as never,
    )

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    // User wheel interaction arrives while the read-only fetch is still pending.
    act(() => {
      const el = document.querySelector('.overlay-scroll-pane')
      el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    })

    await act(async () => {
      resolveFetch!({ items: [message(3, 'user')], totalCount: TOTAL, sourceCount: 1 })
    })
    await new Promise((r) => setTimeout(r, 30))

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(useUIStore.getState().timelineItems.some((it) => it.sessionEntryId === 'entry-3')).toBe(false)
  })

  it('yields to a newly sent message while the fetch is pending', async () => {
    let resolveFetch: (v: { items: TimelineItem[]; totalCount: number; sourceCount: number }) => void
    vi.mocked(ipcClient.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }) as never,
    )

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    // The user sends a new message while the fetch is pending.
    act(() => {
      const next = message(60, 'user')
      next.id = 'live-new'
      next.sessionEntryId = 'entry-60'
      useUIStore.getState().appendTimeline(next)
    })

    await act(async () => {
      resolveFetch!({ items: [message(3, 'user')], totalCount: TOTAL, sourceCount: 1 })
    })
    await new Promise((r) => setTimeout(r, 30))

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
