import { useEffect, useState } from 'react'
import type { GitWorktreeList } from '@shared/git-worktree'
import { workspacePathKey } from '@shared/workspace-path'
import { ipcClient } from '@renderer/lib/ipc-client'

export function useProjectWorktrees(paths: string[]) {
  const [listings, setListings] = useState<GitWorktreeList[]>([])
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(() => new Set())
  const [revision, setRevision] = useState(0)
  const signature = JSON.stringify([...paths].sort((a, b) => workspacePathKey(a).localeCompare(workspacePathKey(b))))

  useEffect(() => {
    let cancelled = false
    const requested: string[] = JSON.parse(signature)
    setLoading(true)
    void (async () => {
      const covered = new Set<string>()
      const next: GitWorktreeList[] = []
      const failedPaths = new Set<string>()
      const missing = new Set<string>()
      let didFail = false
      for (const path of requested) {
        if (covered.has(workspacePathKey(path))) continue
        try {
          const result: GitWorktreeList = await ipcClient.invoke('desktop.gitWorktrees', { workspaceId: path })
          if (cancelled) return
          if (result.missing) missing.add(workspacePathKey(path))
          if (result.ok === false) {
            didFail = true
            failedPaths.add(workspacePathKey(path))
          }
          if (result.repositoryPath && result.trees?.length) {
            next.push(result)
            for (const tree of result.trees) covered.add(workspacePathKey(tree.path))
          }
        } catch {
          if (cancelled) return
          didFail = true
          failedPaths.add(workspacePathKey(path))
        }
      }
      if (!cancelled) {
        setListings((previous) => [...next, ...previous.filter((listing) =>
          listing.trees.some((tree) => failedPaths.has(workspacePathKey(tree.path)))
          && !next.some((fresh) => workspacePathKey(fresh.repositoryPath) === workspacePathKey(listing.repositoryPath)),
        )])
        setFailed(didFail)
        setMissingPaths(missing)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [signature, revision])

  return { listings, missingPaths, failed, loading, refresh: () => setRevision((value) => value + 1) }
}
