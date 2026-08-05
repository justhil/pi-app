import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTreeOverlay } from './session-tree-overlay'
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
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '第一条回复', isLeaf: true },
]

const rAF = () => new Promise((r) => requestAnimationFrame(() => r(null)))

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
  vi.clearAllMocks()
})

describe('SessionTreeOverlay interaction', () => {
  it('Enter views the selected node and closes the overlay', async () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    // Default selection prefers the last non-leaf node (u1 here).
    fireEvent.keyDown(window, { key: 'Enter' })
    await rAF()

    expect(requestTimelineViewEntry).toHaveBeenCalledWith('u1')
    expect(onClose).toHaveBeenCalled()
  })

  it('Enter on the current leaf is a no-op that keeps the overlay open', async () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await rAF()

    expect(requestTimelineViewEntry).not.toHaveBeenCalled()
    expect(navigateSessionToEntry).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('double click rewinds and closes the overlay', async () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: /第一条用户消息/i }))
    await rAF()

    expect(navigateSessionToEntry).toHaveBeenCalledWith('u1')
    expect(onClose).toHaveBeenCalled()
  })
})
