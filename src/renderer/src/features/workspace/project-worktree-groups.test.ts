import { describe, expect, it } from 'vitest'
import { groupSidebarProjects } from './project-worktree-groups'
import type { GitWorktreeList } from '@shared/git-worktree'

const repo: GitWorktreeList = { ok: true, repositoryPath: 'D:/repo', trees: [
  { path: 'D:/repo', branch: 'main', isMain: true, detached: false },
  { path: 'C:/copies/feature', branch: 'feature/ui', isMain: false, detached: false },
] }

describe('sidebar project hierarchy', () => {
  it('groups recent entries from the same repository without duplicating checkouts', () => {
    const groups = groupSidebarProjects(['c:\\copies\\FEATURE\\', 'd:/REPO', '/notes'], [repo])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ repositoryPath: 'D:/repo', projects: repo.trees })
    expect(groups[1]).toMatchObject({ repositoryPath: null, projects: [{ path: '/notes' }] })
  })
  it('keeps independent clones and ordinary projects separate', () => {
    const single: GitWorktreeList = { ok: true, repositoryPath: '/clone', trees: [{ path: '/clone', isMain: true, detached: true }] }
    const groups = groupSidebarProjects(['D:/repo', '/clone', '/notes'], [repo, single])
    expect(groups).toHaveLength(3)
    expect(groups[1]).toMatchObject({ repositoryPath: null, projects: single.trees })
  })
  it('does not keep a removed repository visible just because it was cached', () => {
    expect(groupSidebarProjects(['/notes'], [repo])).toHaveLength(1)
  })
})
