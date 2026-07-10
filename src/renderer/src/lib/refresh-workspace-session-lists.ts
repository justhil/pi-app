import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

export type RefreshWorkspaceSessionListsOptions = {
  /**
   * Explicit workspaces to enumerate. When omitted, only the current disk
   * workspace is listed (never every recent project).
   */
  workspaceIds?: string[]
}

/** In-flight session.list promises, one per workspace (single-flight). */
const inFlightByWorkspace = new Map<string, Promise<void>>()

function resolveWorkspaceIds(options?: RefreshWorkspaceSessionListsOptions): string[] {
  if (options?.workspaceIds) {
    return [...new Set(options.workspaceIds.filter((path) => path && !isSandboxPath(path)))]
  }
  const currentWorkspace = useUIStore.getState().currentWorkspace
  if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
    return [currentWorkspace]
  }
  return []
}

async function listSessionsForWorkspace(workspaceId: string): Promise<void> {
  const existingInFlight = inFlightByWorkspace.get(workspaceId)
  if (existingInFlight) {
    return existingInFlight
  }

  const listPromise = (async () => {
    try {
      const listRes = await ipcClient.invoke('session.list', { workspaceId })
      const list = listRes?.sessions || []
      if (useUIStore.getState().currentWorkspace === workspaceId) {
        useUIStore.getState().setSessions(list)
      }
      // Result publication only — never a refresh trigger.
      window.dispatchEvent(
        new CustomEvent('pi-desktop:workspace-sessions', {
          detail: { workspaceId, sessions: list },
        }),
      )
    } catch (error) {
      console.error('[refreshWorkspaceSessionLists]', workspaceId, error)
    }
  })().finally(() => {
    if (inFlightByWorkspace.get(workspaceId) === listPromise) {
      inFlightByWorkspace.delete(workspaceId)
    }
  })

  inFlightByWorkspace.set(workspaceId, listPromise)
  return listPromise
}

/**
 * Bounded session-list refresh. Does not emit a self-triggering "sessions-changed"
 * event; callers that need a refresh after mutations must invoke this directly.
 */
export async function refreshWorkspaceSessionLists(
  options?: RefreshWorkspaceSessionListsOptions,
): Promise<void> {
  const workspaceIds = resolveWorkspaceIds(options)
  if (workspaceIds.length === 0) return
  await Promise.all(workspaceIds.map((workspaceId) => listSessionsForWorkspace(workspaceId)))
}

/** Test-only: clear single-flight bookkeeping between cases. */
export function __resetRefreshWorkspaceSessionListsForTests(): void {
  inFlightByWorkspace.clear()
}
