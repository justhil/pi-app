import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from './project-sidebar'
import { useUIStore } from '@renderer/stores/ui-store'

/** 记录 session.list 的调用，用来断言 rename 后不重拉列表 */
const sessionListCalls: Array<{ workspaceId?: string; includeArchived?: boolean }> = []

const invokeMock = vi.fn(async (method: string, req?: unknown) => {
  const params = (req || {}) as { key?: string; workspaceId?: string; includeArchived?: boolean }
  if (method === 'session.list') {
    sessionListCalls.push(params)
    const ws = params.workspaceId
      if (ws === '/proj/B') {
        return { sessions: [{ sessionId: 'b1', title: '旧标题', updatedAt: 2, modelId: 'm', sessionFile: '/proj/B/b1.jsonl' }] }
      }
      if (ws === '/proj/A') {
        return { sessions: [{ sessionId: 'a1', title: 'A的会话', updatedAt: 1, modelId: 'm', sessionFile: '/proj/A/a1.jsonl' }] }
      }
      return { sessions: [] }
    }
    if (method === 'settings.get' && params.key === 'recentProjects') {
      return { settings: { recentProjects: ['/proj/A', '/proj/B'] } }
    }
    if (method === 'settings.get' && params.key === 'recentProjectsFixedOrder') {
      return { settings: { recentProjectsFixedOrder: true } }
    }
    if (method === 'workspace.sandbox.list') return { sandboxes: [] }
    if (method === 'workspace.sandbox.listArchived') return { sandboxes: [] }
    if (method === 'session.rename') return { ok: true, title: '新标题B' }
    if (method === 'workspace.open' || method === 'settings.set') return { ok: true }
    return {}
  },
)

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string, req?: unknown) => invokeMock(method, req) },
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(async () => {}),
  switchSessionInPlace: vi.fn(async () => {}),
  previewSessionInPlace: vi.fn(async () => {}),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  useToolCardCatalogReady: () => true,
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('ProjectSidebar rename of a non-current project session', () => {
  beforeEach(() => {
    sessionListCalls.length = 0
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

  it('updates the entry title in place without re-fetching the list', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开" />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // 展开 B，缓存 B 的会话
    const projRow = [...container.querySelectorAll('.sidebar-project-row')].find((n) =>
      n.textContent?.includes('B'),
    )
    await act(async () => {
      fireEvent.click(projRow!.querySelector('.sidebar-project-hit') as Element)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('pi-desktop:workspace-sessions', {
          detail: {
            workspaceId: '/proj/B',
            sessions: [
              { sessionId: 'b1', title: '旧标题', updatedAt: 2, modelId: 'm', sessionFile: '/proj/B/b1.jsonl' },
            ],
          },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const bRowBefore = [...container.querySelectorAll('.sidebar-session-row')].find((n) =>
      n.textContent?.includes('旧标题'),
    )
    expect(bRowBefore).toBeTruthy()

    // 右键 B 的会话 → 重命名 → 确认
    await act(async () => {
      fireEvent.contextMenu(bRowBefore as Element)
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:sidebar.rename'))
    })
    const bListCallsBeforeRename = sessionListCalls.filter((c) => c.workspaceId === '/proj/B').length
    const bArchivedCallsBeforeRename = sessionListCalls.filter(
      (c) => c.workspaceId === '/proj/B' && c.includeArchived,
    ).length
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="text"]') as Element, {
        target: { value: '新标题B' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('common:confirm'))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // 标题原地更新，DOM 节点不重建
    const bRowAfter = [...container.querySelectorAll('.sidebar-session-row')].find((n) =>
      n.textContent?.includes('新标题B'),
    )
    expect(bRowAfter).toBeTruthy()
    expect(bRowAfter).toBe(bRowBefore)
    expect(
      [...container.querySelectorAll('.sidebar-session-row')].some((n) => n.textContent?.includes('旧标题')),
    ).toBe(false)

    // rename 成功后不再整列表重拉（重拉是闪烁源），也未触发归档列表重拉
    const bListCallsAfterRename = sessionListCalls.filter((c) => c.workspaceId === '/proj/B').length
    expect(bListCallsAfterRename).toBe(bListCallsBeforeRename)
    expect(
      sessionListCalls.filter((c) => c.workspaceId === '/proj/B' && c.includeArchived).length,
    ).toBe(bArchivedCallsBeforeRename)
  })
})
