import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
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

function diskChunk(from: number, to: number): TimelineItem[] {
  const out: TimelineItem[] = []
  for (let i = from; i <= to; i++) out.push(message(i, i % 2 === 0 ? 'user' : 'assistant'))
  return out
}

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/s.jsonl',
    timelineItems: [] as TimelineItem[],
    historyTotalCount: TOTAL,
    historyLoadedCount: 0,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle' } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
    ...overrides,
  }
}

let scrollIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  useUIStore.setState(baseState())
  vi.mocked(ipcClient.invoke).mockClear()
  scrollIntoView = vi.fn()
  const origScroll = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = scrollIntoView as unknown as (arg?: boolean | ScrollIntoViewOptions) => void
  const origAnimate = Element.prototype.animate
  Element.prototype.animate = vi.fn(
    () => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation,
  )
  return () => {
    Element.prototype.scrollIntoView = origScroll
    Element.prototype.animate = origAnimate
  }
})

async function flushRaf(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
  }
}

/** Find the scroll pane the timeline pins to, and mock its layout (jsdom has none). */
function mockScrollPane(height = 6000, clientHeight = 800): HTMLElement {
  const pane = document.querySelector('.timeline-scroll-with-dock-pane') as HTMLElement
  if (!pane) throw new Error('timeline scroll pane not rendered')
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => clientHeight })
  return pane
}

describe('stream end + session switch-back follow behavior', () => {
  it('re-engages follow and pins to the latest when the stream ends while the user is near the bottom', async () => {
    // User watched history earlier (a view jump detached follow) but the viewport
    // is back at the bottom when the turn ends.
    useUIStore.setState(
      baseState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TOTAL - TAIL_START + 1,
        streamingAssistantId: 'item-60',
      }),
    )
    render(<Timeline />)
    const pane = mockScrollPane(6000, 800)
    pane.scrollTop = 5860 // 140px from the bottom — inside TIMELINE_NEAR_BOTTOM_PX

    // Detach follow the same way a view jump does.
    const { requestTimelineViewEntry } = await import('./timeline-view-jump')
    act(() => requestTimelineViewEntry('entry-50'))
    await flushRaf(2)

    // Turn finalizes: streaming stops and content grows (scrollHeight +200).
    act(() => {
      useUIStore.setState({ streamingAssistantId: null })
    })
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 6200 })
    await flushRaf()

    // The viewport must be pinned to the NEW bottom (6200), not left at 5860.
    expect(pane.scrollTop).toBe(6200)
  })

  it('re-anchors to the latest when a switched-back session finishes loading', async () => {
    // Switch away: session file cleared, timeline emptied.
    useUIStore.setState(baseState({ historySessionFile: null, timelineItems: [], historyLoading: false }))
    render(<Timeline />)

    // Switch back over a cold path: skeleton first, then the tail lands.
    act(() => {
      useUIStore.setState({
        historySessionFile: '/tmp/proj/s.jsonl',
        timelineItems: [],
        historyLoading: true,
      })
    })
    act(() => {
      useUIStore.setState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TOTAL - TAIL_START + 1,
        historyLoading: false,
      })
    })
    const pane = mockScrollPane(6000, 800)
    pane.scrollTop = 0
    await flushRaf()

    // Entering the session pins to the latest content.
    expect(pane.scrollTop).toBe(6000)
  })

  it('falls back to the item-id anchor when the target row has no sessionEntryId', async () => {
    // Latest user message exists in the store but its sessionEntryId is empty
    // (optimistic placeholder never replaced). The tree node id matches the
    // item id, so the reveal plan says "covered" — but the row renders no
    // data-session-entry-id. The jump must still land via the item-id anchor.
    const items = [...diskChunk(TAIL_START, TOTAL - 1), {
      id: 'entry-60',
      type: 'user-message',
      text: 'latest question',
      timestamp: TOTAL * 1000,
    } as TimelineItem]
    useUIStore.setState(baseState({ timelineItems: items, historyLoadedCount: TOTAL - TAIL_START + 1 }))
    render(<Timeline />)

    const { requestTimelineViewEntry } = await import('./timeline-view-jump')
    act(() => requestTimelineViewEntry('entry-60'))
    await flushRaf(2)

    expect(scrollIntoView).toHaveBeenCalled()
    const target = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(target?.dataset?.itemId).toBe('entry-60')
  })
})
