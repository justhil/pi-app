import { act, fireEvent, render } from '@testing-library/react'
import { Profiler } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0, sourceCount: 0 })) },
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/reload-current-session-data', () => ({ reloadCurrentSessionData: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/session-chrome', () => ({
  useSessionChrome: () => ({ canStop: false, showSpinner: false, sessionKey: null }),
}))

function rows(prefix: string, count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    type: i % 2 === 0 ? 'user-message' : 'assistant-message',
    text: `${prefix} row ${i}`,
    timestamp: i,
    sessionEntryId: `${prefix}-e-${i}`,
  }) as TimelineItem)
}

function sessionState(file: string, items: TimelineItem[]) {
  return {
    currentWorkspace: '/tmp/proj',
    historySessionFile: file,
    timelineItems: items,
    historyTotalCount: items.length,
    historyLoadedCount: items.length,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle', toolCount: 0, errorCount: 0 } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
  }
}

const mountedRows = () => document.querySelectorAll('[data-item-id]').length

async function nextFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('timeline mounted window on session switch (D261-style)', () => {
  it('never over-mounts a new session with the previous session budget, then grows after paint', async () => {
    useUIStore.setState(sessionState('/tmp/proj/a.jsonl', rows('a', 300)))
    const commits: number[] = []
    const { container } = render(
      <Profiler id="timeline" onRender={() => commits.push(mountedRows())}>
        <Timeline />
      </Profiler>,
    )
    await nextFrames()

    // Scroll to the top a few times in session A: the window grows well past the steady size.
    const pane = container.querySelector('.timeline-scroll-with-dock-pane') as HTMLElement
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        fireEvent.scroll(pane)
      })
    }
    expect(mountedRows()).toBeGreaterThan(120)

    commits.length = 0
    act(() => {
      useUIStore.setState(sessionState('/tmp/proj/b.jsonl', rows('b', 300)))
    })
    // Every commit of the switch itself stays within the first-paint window.
    expect(Math.max(...commits)).toBeLessThanOrEqual(16)

    await nextFrames()
    expect(mountedRows()).toBe(40)
  })
})
