import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { TreePanel } from './tree-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
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

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  vi.mocked(requestTimelineViewEntry).mockClear()
  vi.mocked(refreshSessionTree).mockClear()
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

describe('TreePanel refresh behaviour', () => {
  it('refreshes the tree on mount and when the session file changes', () => {
    const refresh = vi.mocked(refreshSessionTree)
    render(<TreePanel />)
    // 树数据是发送时点的快照：即使非空也要在挂载时刷新，
    // 否则「新消息已写入 JSONL 但树未更新」的情况会一直显示旧数据
    expect(refresh).toHaveBeenCalledWith('/tmp/proj/session.jsonl')

    act(() => useUIStore.setState({ historySessionFile: '/other/session.jsonl' }))
    expect(refresh).toHaveBeenLastCalledWith('/other/session.jsonl')
  })

  it('should_auto_refresh_tree_when_agent_turn_settles_to_idle_while_panel_is_open', () => {
    const refresh = vi.mocked(refreshSessionTree)
    useUIStore.setState({ runState: { status: 'running', toolCount: 1, errorCount: 0 } })
    render(<TreePanel />)
    refresh.mockClear()

    act(() => useUIStore.setState({ runState: { status: 'idle', toolCount: 1, errorCount: 0 } }))
    expect(refresh).toHaveBeenCalledWith('/tmp/proj/session.jsonl')
  })
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

describe('TreePanel toolbar layout contracts', () => {
  it('should_keep_filter_radiogroup_and_refresh_non_shrinking_when_panel_is_narrow', () => {
    const { container } = render(<TreePanel />)

    expect(container.querySelector('.tree-panel')).not.toBeNull()

    const radiogroup = screen.getByRole('radiogroup', { name: '显示范围' })
    expect(radiogroup.classList.contains('shrink-0')).toBe(true)
    expect(radiogroup.classList.contains('min-w-0')).toBe(false)

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    for (const radio of radios) {
      expect(radio.classList.contains('shrink-0')).toBe(true)
      expect(radio.classList.contains('whitespace-nowrap')).toBe(true)
    }

    const hint = screen.getByText('单击查看 · 双击回到此处')
    expect(hint.classList.contains('min-w-0')).toBe(true)
    expect(hint.classList.contains('truncate')).toBe(true)
    expect(hint.classList.contains('tree-panel-hint')).toBe(true)
    expect(hint).toHaveAttribute('title', '单击查看 · 双击回到此处')

    const refreshBtn = screen.getByRole('button', { name: '刷新' })
    expect(refreshBtn).toHaveAttribute('aria-label', '刷新')
    expect(refreshBtn.classList.contains('shrink-0')).toBe(true)
  })
})

