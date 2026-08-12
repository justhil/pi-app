import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
}))

vi.mock('@renderer/stores/ui-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/stores/ui-store')>()
  return { useUIStore: actual.useUIStore }
})

vi.mock('@renderer/stores/apply-app-event', () => ({ applyAppEvent: vi.fn() }))

vi.mock('@renderer/lib/available-models-cache', () => ({
  invalidateAvailableModels: vi.fn(),
  prefetchAvailableModels: vi.fn(),
}))

vi.mock('@renderer/lib/refresh-workspace-session-lists', () => ({
  refreshWorkspaceSessionLists: vi.fn(),
}))

vi.mock('@renderer/lib/rewind-metadata', () => ({
  refreshSessionTree: vi.fn(),
}))

import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useUIStore } from '@renderer/stores/ui-store'
import { handleSdkRuntimeChanged } from '../sdk-runtime-changed'

describe('handleSdkRuntimeChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: 'D:/projects/alpha',
      historySessionFile: 'D:/sessions/current.jsonl',
      sessions: [{ sessionId: 'stale', title: 'WSL 会话', updatedAt: 1, modelId: '' }],
    })
  })

  it('should_refresh_current_workspace_and_tree_after_runtime_switch', async () => {
    vi.mocked(refreshWorkspaceSessionLists).mockResolvedValue(undefined)
    vi.mocked(refreshSessionTree).mockResolvedValue(undefined)

    await handleSdkRuntimeChanged()

    expect(invalidateAvailableModels).toHaveBeenCalledOnce()
    expect(prefetchAvailableModels).toHaveBeenCalledOnce()
    expect(useUIStore.getState().sessions).toEqual([])
    expect(useUIStore.getState().rewindTreeNodes).toEqual([])
    expect(refreshWorkspaceSessionLists).toHaveBeenCalledWith({
      workspaceIds: ['D:/projects/alpha'],
    })
    expect(refreshSessionTree).toHaveBeenCalledWith('D:/sessions/current.jsonl')
  })
})
