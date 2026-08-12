import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from './project-sidebar'
import { useUIStore } from '@renderer/stores/ui-store'

/** settings.get(recentProjects) 的响应延迟可控制，用来暴露 setWorkspace 到 reload 之间的瞬态帧 */
let resolveRecentProjects: ((v: unknown) => void) | null = null
let deferNextRecentProjects = false
/** session.list 延迟可控制，用来暴露切换后会话列表重新加载期间的帧 */
let resolveNextSessionList: ((v: unknown) => void) | null = null
let deferNextSessionList = false

const invokeMock = vi.fn(async (method: string, req?: { key?: string; workspaceId?: string }) => {
  if (method === 'session.list') {
    if (deferNextSessionList) {
      return new Promise((res) => {
        resolveNextSessionList = res
      })
    }
    return { sessions: [{ sessionId: 's1', title: '会话1', updatedAt: 1, modelId: 'm' }] }
  }
  if (method === 'settings.get' && req?.key === 'recentProjects') {
    if (deferNextRecentProjects) {
      return new Promise((res) => {
        resolveRecentProjects = res
      })
    }
    return { settings: { recentProjects: ['/proj/A', '/proj/B', '/proj/C'] } }
  }
  if (method === 'settings.get' && req?.key === 'recentProjectsFixedOrder') {
    return { settings: { recentProjectsFixedOrder: true } }
  }
  if (method === 'session.list') return { sessions: [{ sessionId: 's1', title: '会话1', updatedAt: 1, modelId: 'm' }] }
  if (method === 'workspace.sandbox.list') return { sandboxes: [] }
  if (method === 'workspace.open' || method === 'settings.set') return { ok: true }
  return {}
})

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (method: string, req?: { key?: string }) => invokeMock(method, req) } }))
vi.mock('@renderer/lib/refresh-workspace-session-lists', () => ({
  refreshWorkspaceSessionLists: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(async () => {}),
  switchSessionInPlace: vi.fn(async () => {}),
  previewSessionInPlace: vi.fn(async () => {}),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  useToolCardCatalogReady: () => true,
}))

const ROWS_ABC = [expect.stringContaining('A'), expect.stringContaining('B'), expect.stringContaining('C')]

describe('ProjectSidebar folder list stability', () => {
  beforeEach(() => {
    resolveRecentProjects = null
    deferNextRecentProjects = false
    resolveNextSessionList = null
    deferNextSessionList = false
    invokeMock.mockClear()
    useUIStore.setState({
      currentWorkspace: '/proj/A',
      recentProjects: [],
      sessions: [],
      currentSessionId: null,
      historySessionFile: null,
      timelineItems: [],
      subagentSessionGroup: null,
      sessionRuntimeRunning: {},
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the folder order stable on every frame of a workspace switch (fixed order)', async () => {
    const { container } = render(
      <ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开" />,
    )

    // 首次加载：放行 recentProjects，让列表就位 [A,B,C]
    await act(async () => {
      resolveRecentProjects?.({ settings: { recentProjects: ['/proj/A', '/proj/B', '/proj/C'] } })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const rows = () => [...container.querySelectorAll('.sidebar-project-row')]
    expect(rows().length).toBeGreaterThanOrEqual(3)
    expect(rows().map((r) => r.textContent)).toEqual(ROWS_ABC)

    // 切换工作区：本次 recentProjects 响应挂起（模拟真实 IPC 延迟）
    deferNextRecentProjects = true
    await act(async () => {
      useUIStore.getState().setWorkspace('/proj/B')
    })
    // setWorkspace 之后的这一帧：固定顺序下列表不允许跳顶（否则就是闪烁）
    expect(rows().map((r) => r.textContent)).toEqual(ROWS_ABC)
    const frameNodes = rows()
    for (const node of frameNodes) expect(node.isConnected).toBe(true)

    // reload 的 settings.get 返回主进程顺序（固定模式不变）
    deferNextRecentProjects = false
    await act(async () => {
      resolveRecentProjects?.({ settings: { recentProjects: ['/proj/A', '/proj/B', '/proj/C'] } })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(rows().map((r) => r.textContent)).toEqual(ROWS_ABC)
    for (const node of frameNodes) expect(node.isConnected).toBe(true)
  })

  it('does not show the previous workspace sessions under the new folder while loading', async () => {
    useUIStore.setState({
      currentWorkspace: '/proj/A',
      sessions: [{ sessionId: 'a1', title: 'A的会话', updatedAt: 1, modelId: 'm' }],
    })
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开" />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    // Real switch flow: activateWorkspace → setWorkspace clears the old session list
    await act(async () => {
      useUIStore.getState().setWorkspace('/proj/B')
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const trees = [...container.querySelectorAll('.sidebar-session-tree')].map((t) => t.textContent)
    expect(trees[1] || '').not.toContain('A的会话')
  })

  it('shows the cached session list immediately on switch instead of 加载中 while re-fetching', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开" />)
    await act(async () => {
      resolveRecentProjects?.({ settings: { recentProjects: ['/proj/A', '/proj/B', '/proj/C'] } })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // B 的会话已缓存（来自之前的访问）
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('pi-desktop:workspace-sessions', {
          detail: { workspaceId: '/proj/B', sessions: [{ sessionId: 'b1', title: 'B的会话', updatedAt: 2, modelId: 'm' }] },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // 切换到 B，且本次重新拉取挂起（模拟真实 IPC 耗时）
    deferNextSessionList = true
    await act(async () => {
      useUIStore.getState().setWorkspace('/proj/B')
      // 等 rAF：currentWorkspace effect 展开 B 并开始重新拉取
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    const treeText = [...container.querySelectorAll('.sidebar-session-tree')].map((t) => t.textContent)
    expect(treeText.join('')).not.toContain('加载中')
    expect(treeText.join('')).toContain('B的会话')

    // 放行重新拉取，列表仍稳定
    await act(async () => {
      resolveNextSessionList?.({
        sessions: [{ sessionId: 'b1', title: 'B的会话', updatedAt: 2, modelId: 'm' }],
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const after = [...container.querySelectorAll('.sidebar-session-tree')].map((t) => t.textContent)
    expect(after.join('')).not.toContain('加载中')
    expect(after.join('')).toContain('B的会话')
  })

  it('prefers the live session list over a stale cache so a new session is not hidden', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开" />)
    await act(async () => {
      resolveRecentProjects?.({ settings: { recentProjects: ['/proj/A', '/proj/B'] } })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // B 已有旧缓存（来自之前的访问）
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('pi-desktop:workspace-sessions', {
          detail: { workspaceId: '/proj/B', sessions: [{ sessionId: 'b1', title: 'B的旧会话', updatedAt: 2, modelId: 'm' }] },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // 切换到 B（setWorkspace 清空 store.sessions → 瞬态期显示缓存）
    await act(async () => {
      useUIStore.getState().setWorkspace('/proj/B')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    // 新建会话只更新 store.sessions、不发布 workspace-sessions 事件：
    // 实时列表必须优先于旧缓存，否则新会话被旧缓存遮蔽
    await act(async () => {
      useUIStore.getState().setSessions([
        { sessionId: 'b1', title: 'B的旧会话', updatedAt: 2, modelId: 'm' },
        { sessionId: 'b2', title: '新会话', updatedAt: 3, modelId: 'm' },
      ])
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const treeText = [...container.querySelectorAll('.sidebar-session-tree')].map((t) => t.textContent)
    expect(treeText.join('')).toContain('新会话')
  })
})
