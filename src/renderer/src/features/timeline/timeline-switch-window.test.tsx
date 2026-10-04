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

    // The window counts user turns (default 10; every turn here is 2 rows).
    // Scroll to the top a few times in session A: each reveals 10 more turns.
    const pane = container.querySelector('.timeline-scroll-with-dock-pane') as HTMLElement
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        fireEvent.scroll(pane)
      })
    }
    expect(mountedRows()).toBeGreaterThanOrEqual(100)

    commits.length = 0
    act(() => {
      useUIStore.setState(sessionState('/tmp/proj/b.jsonl', rows('b', 300)))
    })
    // Every commit of the switch itself stays within the first-paint window (2 turns).
    expect(Math.max(...commits)).toBeLessThanOrEqual(4)

    await nextFrames()
    expect(mountedRows()).toBe(20)
  })

  it('shows whole user turns, however many tool calls they hold', async () => {
    // 15 turns, each: user message, 30 tool calls, a reply.
    const items: TimelineItem[] = []
    for (let turn = 0; turn < 15; turn++) {
      items.push({ id: `u-${turn}`, type: 'user-message', text: `question ${turn}`, timestamp: turn, sessionEntryId: `eu-${turn}` } as TimelineItem)
      for (let k = 0; k < 30; k++) items.push({ id: `t-${turn}-${k}`, type: 'tool-call', toolName: 'read', toolPhase: 'end', runId: `r${turn}`, timestamp: turn } as TimelineItem)
      items.push({ id: `a-${turn}`, type: 'assistant-message', text: `answer ${turn}`, timestamp: turn, sessionEntryId: `ea-${turn}` } as TimelineItem)
    }
    useUIStore.setState({ ...sessionState('/tmp/proj/turns.jsonl', items), timelineVisibleTurns: 10 })
    render(<Timeline />)
    await nextFrames()
    const text = document.body.textContent ?? ''
    // The last 10 questions and their answers are there; older ones are not.
    for (let turn = 5; turn < 15; turn++) {
      expect(text).toContain(`question ${turn}`)
      expect(text).toContain(`answer ${turn}`)
    }
    expect(text).not.toContain('question 4')
  })
})
