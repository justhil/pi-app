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

/** Disk model: entry-N sits at absolute index N (1-based); chunks follow the real handler. */
function diskChunk(from: number, to: number): TimelineItem[] {
  const out: TimelineItem[] = []
  for (let i = from; i <= to; i++) out.push(message(i, i % 2 === 0 ? 'user' : 'assistant'))
  return out
}

let scrollIntoView: ReturnType<typeof vi.fn>

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

const TAIL_COUNT = TOTAL - TAIL_START + 1 // [40..60] is 21 items

/** Route getMessages like the real handler: leafId pins the branch end; null = real tail. */
function mockDisk() {
  const leafChunk = diskChunk(1, 6) // branch up to entry-3 (target entry-3, index 3)
  const gapChunk = diskChunk(7, TOTAL) // leaf-anchored remainder above entry-3
  const tailChunk = diskChunk(TAIL_START, TOTAL) // plain tail (no leafId)
  vi.mocked(ipcClient.invoke).mockImplementation(((name: string, args: { leafId?: string | null }) => {
    if (name === 'session.getMessages') {
      if (args.leafId === 'entry-3') {
        return Promise.resolve({ items: leafChunk, totalCount: 6, sourceCount: 6 })
      }
      if (args.leafId === null) {
        return Promise.resolve({ items: gapChunk, totalCount: TOTAL, sourceCount: gapChunk.length })
      }
      return Promise.resolve({ items: tailChunk, totalCount: TOTAL, sourceCount: tailChunk.length })
    }
    return Promise.resolve({ items: [], totalCount: 0, sourceCount: 0 })
  }) as never)
}

/** Let chained fetch promises (reveal chunk → gap chunk) all settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })
  }
}

function loadedIds(): number[] {
  return useUIStore
    .getState()
    .timelineItems.map((it) => Number((it.id as string).split('-')[1]))
}

describe('Timeline view-entry reveal during first session load', () => {
  it('keeps a pending jump when the session file arrives after the click (first load)', async () => {
    // Timeline mounts with NO session file yet (hydrating); the tree is already clickable.
    useUIStore.setState(baseState({ historySessionFile: null, historyLoading: true }))
    mockDisk()

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    // The shell finishes hydrating: session file + initial tail arrive.
    act(() => {
      useUIStore.setState({
        historySessionFile: '/tmp/proj/s.jsonl',
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TAIL_COUNT,
        historyLoading: false,
      })
    })

    await flushMicrotasks()

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const target = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(target?.dataset?.sessionEntryId).toBe('entry-3')
    expect(loadedIds()).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1))
  })

  it('lands the jump when the click happens during the skeleton, then the initial tail loads', async () => {
    // Session file known but items still loading (skeleton visible).
    useUIStore.setState(baseState({ timelineItems: [], historyLoading: true, historyLoadedCount: 0 }))
    mockDisk()

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    // Initial 80-tail load resolves and REPLACES the store (shell hydrate semantics).
    act(() => {
      useUIStore.setState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TAIL_COUNT,
        historyLoading: false,
      })
    })

    await flushMicrotasks()

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const target = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(target?.dataset?.sessionEntryId).toBe('entry-3')

    // The store must be contiguous [1..TOTAL] — not [1..6, 40..TOTAL] with a hole.
    expect(loadedIds()).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1))
    expect(useUIStore.getState().historyLoadedCount).toBe(TOTAL)
  })

  it('closes the gap between a far-away target and the loaded tail', async () => {
    // Normal (not first load): only the tail is loaded, target is much older.
    useUIStore.setState(
      baseState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TAIL_COUNT,
      }),
    )
    mockDisk()

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    await flushMicrotasks()

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(loadedIds()).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1))
    expect(useUIStore.getState().historyLoadedCount).toBe(TOTAL)
  })

  it('does not fetch extra history when the target is already inside the loaded tail', async () => {
    useUIStore.setState(
      baseState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TAIL_COUNT,
      }),
    )
    mockDisk()

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-45'))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const leafFetches = vi
      .mocked(ipcClient.invoke)
      .mock.calls.filter((c) => c[0] === 'session.getMessages' && (c[1] as { leafId?: unknown })?.leafId !== undefined)
    expect(leafFetches).toHaveLength(0)
  })

  it('keeps the store contiguous after a cancel-on-wheel (no partial gap left behind)', async () => {
    useUIStore.setState(
      baseState({
        timelineItems: diskChunk(TAIL_START, TOTAL),
        historyLoadedCount: TAIL_COUNT,
      }),
    )
    mockDisk()

    render(<Timeline />)
    act(() => requestTimelineViewEntry('entry-3'))

    // User wheels while the reveal fetch is pending → the jump yields.
    act(() => {
      const el = document.querySelector('.overlay-scroll-pane')
      el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    })

    await flushMicrotasks()

    expect(scrollIntoView).not.toHaveBeenCalled()
    // Nothing may have been prepended by the cancelled jump.
    expect(loadedIds()).toEqual(Array.from({ length: TAIL_COUNT }, (_, i) => i + TAIL_START))
  })
})
