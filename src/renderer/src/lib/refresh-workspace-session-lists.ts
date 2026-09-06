import { ipcClient } from '@renderer/lib/ipc-client'
import { uniqueWorkspacePaths, workspacePathKey } from '@shared/workspace-path'
import type { SessionItem } from '@renderer/features/workspace/project-sidebar-types'
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
const inFlightByWorkspace = new Map<string, Promise<SessionItem[] | null>>()

function resolveWorkspaceIds(options?: RefreshWorkspaceSessionListsOptions): string[] {
  if (options?.workspaceIds) {
    return uniqueWorkspacePaths(options.workspaceIds.filter((path) => path && !isSandboxPath(path)))
  }
  const currentWorkspace = useUIStore.getState().currentWorkspace
  if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
    return [currentWorkspace]
  }
  return []
}

export async function loadWorkspaceSessionList(workspaceId: string): Promise<SessionItem[] | null> {
  const key = workspacePathKey(workspaceId)
  const existingInFlight = inFlightByWorkspace.get(key)
  if (existingInFlight) {
    return existingInFlight
  }

  const listPromise = (async () => {
    try {
      const listRes = await ipcClient.invoke('session.list', { workspaceId, refresh: true })
      const list: SessionItem[] = listRes?.sessions || []
      useUIStore.getState().setSessions(list, workspaceId)
      // Result publication only — never a refresh trigger.
      window.dispatchEvent(
        new CustomEvent('pi-desktop:workspace-sessions', {
          detail: { workspaceId, sessions: list },
        }),
      )
      return list
    } catch (error) {
      console.error('[refreshWorkspaceSessionLists]', workspaceId, error)
      window.dispatchEvent(new CustomEvent('pi-desktop:workspace-sessions', {
        detail: { workspaceId, error: error instanceof Error ? error.message : String(error) },
      }))
      return null
    }
  })().finally(() => {
    if (inFlightByWorkspace.get(key) === listPromise) {
      inFlightByWorkspace.delete(key)
    }
  })

  inFlightByWorkspace.set(key, listPromise)
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
  for (const workspaceId of workspaceIds) await loadWorkspaceSessionList(workspaceId)
}

/** Test-only: clear single-flight bookkeeping between cases. */
export function __resetRefreshWorkspaceSessionListsForTests(): void {
  inFlightByWorkspace.clear()
}
