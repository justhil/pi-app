import { mkdir, readdir, rmdir } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { workspacePathsEqual } from '@shared/workspace-path'
import { gitExec } from './git-workspace'
import { listGitWorktrees } from './git-worktrees'

function firstErrorLine(stderr: string, stdout: string, fallback: string): string {
  const raw = (stderr || stdout || '').trim()
  return raw.split(/\r?\n/).find((l) => l.trim())?.trim() || fallback
}

export async function createGitWorktree(
  cwd: string,
  branchInput: string,
): Promise<{ ok: true; path: string; branch: string } | { ok: false; error: string }> {
  const branch = branchInput.trim()
  if (!branch) return { ok: false, error: 'Branch name is required' }
  const listing = await listGitWorktrees(cwd)
  if (!listing.ok || !listing.repositoryPath) {
    return { ok: false, error: listing.error || 'Not a Git repository' }
  }
  const repoPath = listing.repositoryPath
  const check = await gitExec(repoPath, ['check-ref-format', '--branch', branch], { timeout: 5000 })
  if (check.status !== 0) {
    return { ok: false, error: firstErrorLine(check.stderr, check.stdout, 'Invalid branch name') }
  }
  const folderSlug = branch.replace(/[\\/:\s*?"<>|]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
  const repoName = basename(repoPath.replace(/[\\/]+$/, '')) || 'repo'
  const worktreesRoot = join(dirname(repoPath.replace(/[\\/]+$/, '')), `${repoName}.worktrees`)
  const targetPath = join(worktreesRoot, folderSlug)
  await mkdir(worktreesRoot, { recursive: true })

  const exists = await gitExec(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { timeout: 5000 })
  const args = exists.status === 0
    ? ['worktree', 'add', targetPath, branch]
    : ['worktree', 'add', '-b', branch, targetPath]
  const res = await gitExec(repoPath, args, { timeout: 30000 })
  if (res.status !== 0) {
    return { ok: false, error: firstErrorLine(res.stderr, res.stdout, 'git worktree add failed') }
  }
  return { ok: true, path: targetPath, branch }
}

export async function removeGitWorktree(
  cwd: string,
  worktreePath: string,
): Promise<{ ok: true; repositoryPath: string | null } | { ok: false; error: string }> {
  const listing = await listGitWorktrees(cwd)
  const repoPath = listing.repositoryPath || cwd
  if (workspacePathsEqual(repoPath, worktreePath)) {
    return { ok: false, error: 'Cannot delete the main worktree' }
  }
  const res = await gitExec(repoPath, ['worktree', 'remove', '--force', worktreePath], { timeout: 30000 })
  if (res.status !== 0) {
    return { ok: false, error: firstErrorLine(res.stderr, res.stdout, 'git worktree remove failed') }
  }
  await gitExec(repoPath, ['worktree', 'prune'], { timeout: 5000 }).catch(() => {})
  const parentDir = dirname(worktreePath.replace(/[\\/]+$/, ''))
  if (parentDir.endsWith('.worktrees')) {
    const entries = await readdir(parentDir).catch(() => ['non-empty'])
    if (entries.length === 0) await rmdir(parentDir).catch(() => {})
  }
  return { ok: true, repositoryPath: listing.repositoryPath }
}
