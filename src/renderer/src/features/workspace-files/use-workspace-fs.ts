import { useCallback } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { FsEntry } from './workspace-files-types'
import { PREVIEW_READ_MAX_BYTES } from './file-preview-limits'
import { LIST_DIR_MAX_ENTRIES } from './file-tree-limits'

export function useWorkspaceFs(workspaceRoot: string | null) {
  const listDir = useCallback(
    async (relativePath: string) => {
      if (!workspaceRoot) return { ok: false as const, entries: [] as FsEntry[], error: 'missing_root' as const }
      const res = await ipcClient.invoke('workspace.fs.listDir', {
        workspaceRoot,
        path: relativePath || '.',
        maxEntries: LIST_DIR_MAX_ENTRIES,
      })
      return res as { ok: boolean; entries?: FsEntry[]; error?: string }
    },
    [workspaceRoot],
  )

  const readText = useCallback(
    async (relativePath: string) => {
      if (!workspaceRoot) return { ok: false as const, error: 'missing_root' as const }
      const res = await ipcClient.invoke('workspace.fs.readText', {
        workspaceRoot,
        path: relativePath,
        maxBytes: PREVIEW_READ_MAX_BYTES,
      })
      return res as { ok: boolean; content?: string; error?: string; size?: number }
    },
    [workspaceRoot],
  )

  return { listDir, readText }
}