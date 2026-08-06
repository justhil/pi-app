import { render, screen, waitFor } from '@testing-library/react'
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

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/s.jsonl',
    timelineItems: [] as TimelineItem[],
    historyTotalCount: 0,
    historyLoadedCount: 0,
    historyLoading: false,
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'idle' } as never,
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { status: 'idle' } as never,
    timelineMaxAutoExpandedTools: 5,
    ...overrides,
  }
}

beforeEach(() => {
  useUIStore.setState(baseState())
  vi.mocked(ipcClient.invoke).mockClear()
  const origAnimate = Element.prototype.animate
  Element.prototype.animate = vi.fn(
    () => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation,
  )
  return () => {
    Element.prototype.animate = origAnimate
  }
})

const thinkingRow = (id: string, text: string): TimelineItem =>
  ({
    id,
    type: 'assistant-message',
    thinkingText: text,
    text: '',
    timestamp: 1000,
    sessionEntryId: id,
  }) as TimelineItem

describe('activity window auto-expand', () => {
  it('expands the newest thinking rows within the window, collapses older ones', async () => {
    const items = [
      thinkingRow('old-1', 'OLD THINKING ONE'),
      thinkingRow('old-2', 'OLD THINKING TWO'),
      thinkingRow('new-1', 'NEW THINKING ONE'),
      thinkingRow('new-2', 'NEW THINKING TWO'),
    ]
    useUIStore.setState(
      baseState({
        timelineItems: items,
        historyTotalCount: items.length,
        historyLoadedCount: items.length,
        timelineMaxAutoExpandedTools: 2,
      }),
    )
    render(<Timeline />)
    await waitFor(() => expect(screen.getByText('NEW THINKING TWO')).toBeTruthy())
    expect(screen.getByText('NEW THINKING ONE')).toBeTruthy()
    expect(screen.queryByText('OLD THINKING TWO')).toBeNull()
    expect(screen.queryByText('OLD THINKING ONE')).toBeNull()
  })

  it('window size 0 disables auto-expand entirely', async () => {
    const items = [
      thinkingRow('a', 'ONLY THINKING'),
      thinkingRow('b', 'LAST THINKING'),
    ]
    useUIStore.setState(
      baseState({
        timelineItems: items,
        historyTotalCount: items.length,
        historyLoadedCount: items.length,
        timelineMaxAutoExpandedTools: 0,
      }),
    )
    render(<Timeline />)
    await waitFor(() => expect(screen.queryByText('LAST THINKING')).toBeNull())
  })

  it('auto-expands a tool group when any of its tools hits the window budget', async () => {
    const toolRow = (id: string, name: string): TimelineItem =>
      ({
        id,
        type: 'tool-call',
        toolName: name,
        toolPhase: 'end',
        toolArgs: {},
        toolOutput: '',
        timestamp: 1000,
        sessionEntryId: id,
      }) as TimelineItem
    const items = [
      toolRow('t1', 'bash'),
      toolRow('t2', 'read'),
      // 段封：工具后跟随 prose → 工具行合并为一个 tool-group
      ({ id: 'p1', type: 'assistant-message', text: 'done', timestamp: 2000, sessionEntryId: 'p1' }) as TimelineItem,
    ]
    useUIStore.setState(
      baseState({
        timelineItems: items,
        historyTotalCount: items.length,
        historyLoadedCount: items.length,
        timelineMaxAutoExpandedTools: 2,
      }),
    )
    render(<Timeline />)
    await waitFor(() => {
      const groupBtn = document.querySelector('.tool-group-hit') as HTMLElement | null
      expect(groupBtn?.getAttribute('aria-expanded')).toBe('true')
    })
    // 组展开后工具行内容可见
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('read')).toBeTruthy()
  })

  it('keeps tool groups collapsed when the window is disabled', async () => {
    const toolRow = (id: string, name: string): TimelineItem =>
      ({
        id,
        type: 'tool-call',
        toolName: name,
        toolPhase: 'end',
        toolArgs: {},
        toolOutput: '',
        timestamp: 1000,
        sessionEntryId: id,
      }) as TimelineItem
    const items = [
      toolRow('t1', 'bash'),
      toolRow('t2', 'read'),
      ({ id: 'p1', type: 'assistant-message', text: 'done', timestamp: 2000, sessionEntryId: 'p1' }) as TimelineItem,
    ]
    useUIStore.setState(
      baseState({
        timelineItems: items,
        historyTotalCount: items.length,
        historyLoadedCount: items.length,
        timelineMaxAutoExpandedTools: 0,
      }),
    )
    render(<Timeline />)
    await waitFor(() => {
      const groupBtn = document.querySelector('.tool-group-hit') as HTMLElement | null
      expect(groupBtn?.getAttribute('aria-expanded')).toBe('false')
    })
  })
})
