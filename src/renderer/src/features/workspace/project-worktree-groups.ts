import type { GitWorktree, GitWorktreeList } from '@shared/git-worktree'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'

export type SidebarProjectGroup = {
  key: string
  repositoryPath: string | null
  projects: GitWorktree[]
}

export function groupSidebarProjects(paths: string[], listings: GitWorktreeList[]): SidebarProjectGroup[] {
  const membership = new Map<string, GitWorktreeList>()
  for (const listing of listings) {
    if (!listing.repositoryPath) continue
    for (const tree of listing.trees) membership.set(workspacePathKey(tree.path), listing)
  }
  const groups: SidebarProjectGroup[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const listing = membership.get(workspacePathKey(path))
    const key = workspacePathKey(listing?.repositoryPath || path)
    if (seen.has(key)) continue
    seen.add(key)
    const projects = listing ? [...listing.trees] : [{ path, isMain: true, detached: false }]
    projects.sort((a, b) => {
      if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
      const index = (p: string) => {
        const i = paths.findIndex((candidate) => workspacePathsEqual(p, candidate))
        return i < 0 ? paths.length : i
      }
      return index(a.path) - index(b.path)
    })
    groups.push({ key, repositoryPath: projects.length > 1 ? listing!.repositoryPath : null, projects })
  }
  return groups
}
