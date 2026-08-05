import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TreePanel } from './tree-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))
vi.mock('@renderer/features/timeline/timeline-view-jump', () => ({
  requestTimelineViewEntry: vi.fn(),
}))

const nodes = [
  { id: 'u1', depth: 0, entryType: 'message', role: 'user', preview: '第一条用户消息', isLeaf: false },
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '第一条回复', isLeaf: false },
  { id: 'u2', depth: 2, entryType: 'message', role: 'user', preview: '第二条用户消息', isLeaf: false },
  { id: 'a2', depth: 3, entryType: 'message', role: 'assistant', preview: '第二条回复', isLeaf: true },
]

beforeEach(() => {
  vi.mocked(requestTimelineViewEntry).mockClear()
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/session.jsonl',
    rewindTreeNodes: nodes as never,
    rewindLoadingTree: false,
    rewindTreeError: undefined,
    rewindKey: '/tmp/proj/session.jsonl',
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TreePanel user-only filter', () => {
  it('single click on a user row requests a non-destructive view jump', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByText('仅用户'))
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /第一条用户消息/i }))

    expect(requestTimelineViewEntry).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(250))
    expect(requestTimelineViewEntry).toHaveBeenCalledOnce()
    expect(requestTimelineViewEntry).toHaveBeenCalledWith('u1')
  })

  it('double click on a user row rewinds instead of viewing', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByText('仅用户'))
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /第一条用户消息/i }))
    fireEvent.doubleClick(screen.getByRole('button', { name: /第一条用户消息/i }))

    act(() => vi.advanceTimersByTime(250))
    expect(requestTimelineViewEntry).not.toHaveBeenCalled()
    expect(navigateSessionToEntry).toHaveBeenCalledOnce()
    expect(navigateSessionToEntry).toHaveBeenCalledWith('u1')
  })

  it('only user rows are shown in the user-only tab', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByText('仅用户'))

    expect(screen.getByRole('button', { name: /第一条用户消息/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /第一条回复/i })).toBeNull()
  })
})
