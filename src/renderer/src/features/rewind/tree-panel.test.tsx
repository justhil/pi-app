import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TreePanel } from './tree-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))

const nodes = [
  { id: 'u1', depth: 0, entryType: 'message', role: 'user', preview: '第一条用户消息', isLeaf: false },
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '第一条回复', isLeaf: true },
]

beforeEach(() => {
  vi.mocked(refreshSessionTree).mockClear()
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/session.jsonl',
    rewindTreeNodes: nodes as never,
    rewindLoadingTree: false,
    rewindTreeError: undefined,
  })
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
})
