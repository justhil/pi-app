import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useUIStore } from '@renderer/stores/ui-store'

export async function handleSdkRuntimeChanged(): Promise<void> {
  invalidateAvailableModels()
  prefetchAvailableModels()

  const store = useUIStore.getState()
  const workspaceId = store.currentWorkspace
  const sessionFile = store.historySessionFile
  store.setSessions([])
  store.setRewindMeta({ treeNodes: [], treeError: '' })

  await refreshWorkspaceSessionLists({
    workspaceIds: workspaceId ? [workspaceId] : [],
  })
  if (sessionFile) await refreshSessionTree(sessionFile)
}
