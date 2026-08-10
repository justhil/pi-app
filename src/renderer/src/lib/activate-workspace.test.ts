import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateWorkspace } from './activate-workspace'
import { useUIStore } from '@renderer/stores/ui-store'

const invokeMock = vi.hoisted(() =>
  vi.fn(async (method: string) => {
    if (method === 'workspace.open') return { ok: true }
    if (method === 'session.list') return { sessions: [] }
    if (method === 'settings.set') return { ok: true }
    return {}
  }),
)

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (method: string) => invokeMock(method) } }))
vi.mock('@renderer/lib/open-session', () => ({
  openSessionIntoWorker: vi.fn(async () => {}),
  openSessionPreview: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/session-shell', () => ({ focusSessionSync: vi.fn() }))
vi.mock('@renderer/lib/capture-live-session-timeline', () => ({
  captureVisibleLiveSessionTimeline: vi.fn(),
}))
vi.mock('@renderer/lib/session-worker-sync', () => ({ fetchWorkerLiveSnapshot: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn() }))
vi.mock('@renderer/lib/workspace-session-choice', () => ({
  chooseWorkspaceSession: vi.fn(() => undefined),
}))
vi.mock('@renderer/lib/session-navigation', () => ({
  beginSessionNavigation: vi.fn(() => 1),
  assertSessionNavigation: vi.fn(() => true),
}))

describe('activateWorkspace clears the stale session list on a real workspace switch', () => {
  beforeEach(() => {
    invokeMock.mockClear()
    useUIStore.setState({
      currentWorkspace: '/proj/A',
      sessions: [{ sessionId: 'a1', title: 'A的会话', updatedAt: 1, modelId: 'm' }],
    })
  })

  it('clears sessions synchronously when switching to another workspace', async () => {
    const promise = activateWorkspace('/proj/B')
    // 同步部分先执行：setWorkspace + 清空旧工作区 sessions（防止新文件夹树短暂显示旧会话）
    expect(useUIStore.getState().currentWorkspace).toBe('/proj/B')
    expect(useUIStore.getState().sessions).toEqual([])
    await promise
  })

  it('keeps sessions when reactivating the same workspace', async () => {
    const promise = activateWorkspace('/proj/A')
    expect(useUIStore.getState().sessions).toHaveLength(1)
    await promise
  })
})
