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

  it('renders branch indentation and fold controls in user-only mode (#150)', () => {
    const branched = [
      { id: 'u1', parentId: null, depth: 0, entryType: 'message', role: 'user', preview: '起点问题', isLeaf: false },
      { id: 'a1', parentId: 'u1', depth: 1, entryType: 'message', role: 'assistant', preview: '初始回答', isLeaf: false },
      { id: 'u2a', parentId: 'a1', depth: 2, entryType: 'message', role: 'user', preview: '分支A首问', isLeaf: false },
      { id: 'a2a', parentId: 'u2a', depth: 3, entryType: 'message', role: 'assistant', preview: '分支A首答', isLeaf: false },
      { id: 'u3a', parentId: 'a2a', depth: 4, entryType: 'message', role: 'user', preview: '分支A追问', isLeaf: false },
      { id: 'a3a', parentId: 'u3a', depth: 5, entryType: 'message', role: 'assistant', preview: '分支A追答', isLeaf: false },
      { id: 'u2b', parentId: 'a1', depth: 2, entryType: 'message', role: 'user', preview: '分支B首问', isLeaf: false },
      { id: 'a2b', parentId: 'u2b', depth: 3, entryType: 'message', role: 'assistant', preview: '分支B首答', isLeaf: false },
      { id: 'u3b', parentId: 'a2b', depth: 4, entryType: 'message', role: 'user', preview: '分支B追问', isLeaf: false },
      { id: 'a3b', parentId: 'u3b', depth: 5, entryType: 'message', role: 'assistant', preview: '分支B追答', isLeaf: true },
    ]
    useUIStore.setState({ rewindTreeNodes: branched as never })

    const { container } = render(<TreePanel />)
    fireEvent.click(screen.getByText('仅用户'))

    // Both branches indent under 起点问题 (col 1) and render SVG branch connectors
    const branchARow = screen.getByRole('button', { name: /分支A首问/i }).closest('li')!
    const branchBRow = screen.getByRole('button', { name: /分支B首问/i }).closest('li')!
    expect(branchARow).toHaveAttribute('data-tree-col', '1')
    expect(branchBRow).toHaveAttribute('data-tree-col', '1')
    expect(branchBRow).toHaveAttribute('data-active-path', 'true')
    expect(container.querySelectorAll('[data-tree-branch-gutter]').length).toBe(5)

    // Fold Branch A: hides 分支A追问 and displays +1 badge; clicking badge expands again
    const foldA = container.querySelector('[data-tree-fold-toggle="u2a"]')!
    fireEvent.click(foldA)
    expect(screen.queryByRole('button', { name: /分支A追问/i })).toBeNull()
    const badge = container.querySelector('[data-tree-folded-badge="u2a"]')!
    expect(badge.textContent).toBe('+1')
    fireEvent.click(badge)
    expect(screen.getByRole('button', { name: /分支A追问/i })).toBeTruthy()

    // Collapse all / expand all toolbar button toggles all branch segments
    fireEvent.click(screen.getByRole('button', { name: '收起所有分支' }))
    expect(screen.queryByRole('button', { name: /分支A追问/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /分支B追问/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开所有分支' }))
    expect(screen.getByRole('button', { name: /分支A追问/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /分支B追问/i })).toBeTruthy()
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

describe('TreePanel Plan A turn cards, search, focus and quick rewind', () => {
  const branchedWithTools = [
    { id: 'u1', parentId: null, depth: 0, entryType: 'message', role: 'user', preview: '排查超时问题', isLeaf: false },
    { id: 'a1-t1', parentId: 'u1', depth: 1, entryType: 'message', role: 'assistant', preview: '', isLeaf: false },
    { id: 'tr1', parentId: 'a1-t1', depth: 2, entryType: 'message', role: 'toolResult', preview: 'grep output', isLeaf: false },
    { id: 'a1-t2', parentId: 'tr1', depth: 3, entryType: 'message', role: 'assistant', preview: '', isLeaf: false },
    { id: 'tr2', parentId: 'a1-t2', depth: 4, entryType: 'message', role: 'toolResult', preview: 'log output', isLeaf: false },
    { id: 'a1-done', parentId: 'tr2', depth: 5, entryType: 'message', role: 'assistant', preview: '定位到连接池泄漏。', isLeaf: false },
    // Branch A (historical)
    { id: 'u2a', parentId: 'a1-done', depth: 6, entryType: 'message', role: 'user', preview: '方案 A：调大连接池上限', isLeaf: false },
    { id: 'a2a', parentId: 'u2a', depth: 7, entryType: 'message', role: 'assistant', preview: '已改为 Redis 连接池方案。', isLeaf: false },
    { id: 'u3a', parentId: 'a2a', depth: 8, entryType: 'message', role: 'user', preview: '压测分支 A', isLeaf: false },
    { id: 'a3a', parentId: 'u3a', depth: 9, entryType: 'message', role: 'assistant', preview: '分支 A 压测通过。', isLeaf: false },
    // Branch B (active)
    { id: 'u2b', parentId: 'a1-done', depth: 6, entryType: 'message', role: 'user', preview: '方案 B：改成复用长连接', isLeaf: false },
    { id: 'a2b', parentId: 'u2b', depth: 7, entryType: 'message', role: 'assistant', preview: '已切换为长连接复用。', isLeaf: true },
  ]

  it('aggregates tool calls into turn cards, shows fork badge, and rewinds via quick button', () => {
    useUIStore.setState({ rewindTreeNodes: branchedWithTools as never })
    const { container } = render(<TreePanel />)

    // Default Chat mode produces 4 turn cards (u1, u2a, u3a, u2b) with tool steps folded on u1
    expect(container.querySelectorAll('[data-turn-card="true"]').length).toBe(4)
    expect(container.querySelector('[data-tree-tool-steps="u1"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-tree-fork-badge="u1"]')?.textContent).toBe('2')
    expect(screen.getByText('定位到连接池泄漏。')).toBeInTheDocument()
    expect(screen.getByText('2 分支 · 4 轮')).toBeInTheDocument()

    // Quick rewind button exists on historical turns (rewinds to continueAfterId = a2a), absent on active leaf turn u2b
    expect(container.querySelector('[data-tree-rewind-btn="u2b"]')).toBeNull()
    const rewindBtn = container.querySelector('[data-tree-rewind-btn="u2a"]')!
    fireEvent.click(rewindBtn)
    expect(navigateSessionToEntry).toHaveBeenCalledWith('a2a')
  })

  it('filters turns by search query (matching reply summary) while preserving ancestors', () => {
    useUIStore.setState({ rewindTreeNodes: branchedWithTools as never })
    render(<TreePanel />)

    const input = screen.getByPlaceholderText('搜索对话或分支…')
    fireEvent.change(input, { target: { value: 'Redis' } })

    expect(screen.getByText('1 处匹配')).toBeInTheDocument()
    expect(screen.getByText('排查超时问题')).toBeInTheDocument()
    expect(screen.getByText('方案 A：调大连接池上限')).toBeInTheDocument()
    expect(screen.queryByText('方案 B：改成复用长连接')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(screen.getByText('方案 B：改成复用长连接')).toBeInTheDocument()
  })

  it('focuses active branch by collapsing only non-active sibling branches', () => {
    useUIStore.setState({ rewindTreeNodes: branchedWithTools as never })
    render(<TreePanel />)

    const focusBtn = screen.getByRole('button', { name: '仅看当前' })
    fireEvent.click(focusBtn)

    // Non-active descendant u3a is collapsed while active branch u2b stays visible
    expect(screen.queryByText('压测分支 A')).toBeNull()
    expect(screen.getByText('方案 B：改成复用长连接')).toBeInTheDocument()

    // Clicking again restores all branches
    fireEvent.click(focusBtn)
    expect(screen.getByText('压测分支 A')).toBeInTheDocument()
  })
})

