import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

export async function refreshWorkspaceSessionLists(): Promise<void> {
  const paths = new Set<string>()
  const wid = useUIStore.getState().currentWorkspace
  if (wid && !isSandboxPath(wid)) paths.add(wid)
  for (const p of useUIStore.getState().recentProjects) {
    if (!isSandboxPath(p)) paths.add(p)
  }
  await Promise.all(
    [...paths].map(async (workspaceId) => {
      try {
        const listRes = await ipcClient.invoke('session.list', { workspaceId })
        const list = listRes?.sessions || []
        if (useUIStore.getState().currentWorkspace === workspaceId) {
          useUIStore.getState().setSessions(list)
        }
        window.dispatchEvent(
          new CustomEvent('pi-desktop:workspace-sessions', { detail: { workspaceId, sessions: list } }),
        )
      } catch (e) {
        console.error('[refreshWorkspaceSessionLists]', workspaceId, e)
      }
    }),
  )
  window.dispatchEvent(new Event('pi-desktop:sessions-changed'))
}