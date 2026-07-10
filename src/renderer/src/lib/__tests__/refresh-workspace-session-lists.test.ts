import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    // Default resolved value so ui-store module side effects (adapter catalog) do not reject.
    invoke: vi.fn().mockResolvedValue({}),
  },
}))

import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  __resetRefreshWorkspaceSessionListsForTests,
  refreshWorkspaceSessionLists,
} from '../refresh-workspace-session-lists'

function mockSessionListResponse(method: string, payload?: { workspaceId?: string }) {
  if (method !== 'session.list') {
    throw new Error(`unexpected method ${method}`)
  }
  return {
    sessions: [
      {
        sessionId: `s-${payload?.workspaceId}`,
        sessionFile: `${payload?.workspaceId}/s.jsonl`,
        title: payload?.workspaceId,
        updatedAt: Date.now(),
      },
    ],
  }
}

describe('refreshWorkspaceSessionLists', () => {
  beforeEach(() => {
    __resetRefreshWorkspaceSessionListsForTests()
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({
      currentWorkspace: 'D:/projects/alpha',
      recentProjects: ['D:/projects/alpha', 'D:/projects/beta', 'D:/projects/gamma'],
      sessions: [],
    })
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string, payload?: { workspaceId?: string }) =>
      mockSessionListResponse(method, payload),
    )
  })

  it('lists only the current workspace by default, not every recent project', async () => {
    await refreshWorkspaceSessionLists()

    expect(ipcClient.invoke).toHaveBeenCalledTimes(1)
    expect(ipcClient.invoke).toHaveBeenCalledWith('session.list', { workspaceId: 'D:/projects/alpha' })
    expect(useUIStore.getState().sessions).toHaveLength(1)
  })

  it('lists only the explicit workspace ids when provided', async () => {
    await refreshWorkspaceSessionLists({
      workspaceIds: ['D:/projects/beta', 'D:/projects/gamma'],
    })

    const listed = vi
      .mocked(ipcClient.invoke)
      .mock.calls.map((call) => (call[1] as { workspaceId?: string } | undefined)?.workspaceId)
      .sort()
    expect(listed).toEqual(['D:/projects/beta', 'D:/projects/gamma'])
    expect(useUIStore.getState().sessions).toEqual([])
  })

  it('coalesces concurrent list requests for the same workspace (single-flight)', async () => {
    let releaseList!: (value: unknown) => void
    const listGate = new Promise((resolve) => {
      releaseList = resolve
    })
    vi.mocked(ipcClient.invoke).mockImplementation(async () => {
      await listGate
      return { sessions: [{ sessionId: 's1', sessionFile: 'a.jsonl', title: 'a', updatedAt: 1 }] }
    })

    const first = refreshWorkspaceSessionLists({ workspaceIds: ['D:/projects/alpha'] })
    const second = refreshWorkspaceSessionLists({ workspaceIds: ['D:/projects/alpha'] })
    releaseList({})
    await Promise.all([first, second])

    expect(ipcClient.invoke).toHaveBeenCalledTimes(1)
  })

  it('publishes workspace-sessions results without emitting sessions-changed', async () => {
    const workspaceSessionsHandler = vi.fn()
    const sessionsChangedHandler = vi.fn()
    window.addEventListener('pi-desktop:workspace-sessions', workspaceSessionsHandler)
    window.addEventListener('pi-desktop:sessions-changed', sessionsChangedHandler)

    await refreshWorkspaceSessionLists({ workspaceIds: ['D:/projects/alpha'] })

    expect(workspaceSessionsHandler).toHaveBeenCalledTimes(1)
    expect(sessionsChangedHandler).not.toHaveBeenCalled()

    window.removeEventListener('pi-desktop:workspace-sessions', workspaceSessionsHandler)
    window.removeEventListener('pi-desktop:sessions-changed', sessionsChangedHandler)
  })

  it('does not form a recursive refresh when a sessions-changed listener is present', async () => {
    const recursiveListener = vi.fn(() => {
      void refreshWorkspaceSessionLists()
    })
    window.addEventListener('pi-desktop:sessions-changed', recursiveListener)

    await refreshWorkspaceSessionLists()

    expect(recursiveListener).not.toHaveBeenCalled()
    expect(ipcClient.invoke).toHaveBeenCalledTimes(1)

    window.removeEventListener('pi-desktop:sessions-changed', recursiveListener)
  })

  it('skips sandbox workspace paths', async () => {
    await refreshWorkspaceSessionLists({
      workspaceIds: ['C:/Users/me/.pi/sandbox-workspaces/tmp-1', 'D:/projects/alpha'],
    })

    expect(ipcClient.invoke).toHaveBeenCalledTimes(1)
    expect(ipcClient.invoke).toHaveBeenCalledWith('session.list', { workspaceId: 'D:/projects/alpha' })
  })
})
