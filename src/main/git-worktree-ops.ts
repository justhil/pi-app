import { mkdir, readdir, rmdir } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { gitExec } from './git-workspace'
import { listGitWorktrees } from './git-worktrees'

/** Per-repository async queue so parallel worktree creation/removal never races on .git/config.lock. */
const repoWorktreeQueues = new Map<string, Promise<unknown>>()

export async function withRepoWorktreeLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const key = workspacePathKey(repoPath) || repoPath.toLowerCase()
  const prev = repoWorktreeQueues.get(key) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(task)
  const tracked = run.finally(() => {
    if (repoWorktreeQueues.get(key) === tracked) {
      repoWorktreeQueues.delete(key)
    }
  })
  repoWorktreeQueues.set(key, tracked)
  return run
}

function firstErrorLine(stderr: string, stdout: string, fallback: string): string {
  const raw = (stderr || stdout || '').trim()
  return raw.split(/\r?\n/).find((l) => l.trim())?.trim() || fallback
}

export interface CreateGitWorktreeOptions {
  baseBranch?: string | null
  fromOrigin?: boolean
  pullRequestNumber?: number | null
}

export async function createGitWorktree(
  cwd: string,
  branchInput: string,
  options?: CreateGitWorktreeOptions,
): Promise<{ ok: true; path: string; branch: string; baseRef?: string } | { ok: false; error: string }> {
  const branch = branchInput.trim()
  if (!branch) return { ok: false, error: 'Branch name is required' }
  const listing = await listGitWorktrees(cwd)
  if (!listing.ok || !listing.repositoryPath) {
    return { ok: false, error: listing.error || 'Not a Git repository' }
  }
  const repoPath = listing.repositoryPath

  return withRepoWorktreeLock(repoPath, async () => {
    const check = await gitExec(repoPath, ['check-ref-format', '--branch', branch], { timeout: 5000 })
    if (check.status !== 0) {
      return { ok: false, error: firstErrorLine(check.stderr, check.stdout, 'Invalid branch name') }
    }
    const folderSlug = branch.replace(/[\\/:\s*?"<>|]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
    const repoName = basename(repoPath.replace(/[\\/]+$/, '')) || 'repo'
    const worktreesRoot = join(dirname(repoPath.replace(/[\\/]+$/, '')), `${repoName}.worktrees`)
    const targetPath = join(worktreesRoot, folderSlug)
    await mkdir(worktreesRoot, { recursive: true })

    // When checking out a GitHub PR, fetch refs/pull/<N>/head directly so even external fork PRs work seamlessly!
    if (options?.pullRequestNumber && options.pullRequestNumber > 0) {
      const prFetch = await gitExec(
        repoPath,
        ['fetch', '--quiet', 'origin', `+refs/pull/${options.pullRequestNumber}/head:refs/heads/${branch}`],
        { timeout: 20000 },
      ).catch(() => ({ status: 1, stdout: '', stderr: '' }))
      if (prFetch.status === 0) {
        const res = await gitExec(repoPath, ['worktree', 'add', targetPath, branch], { timeout: 30000 })
        if (res.status === 0) {
          return { ok: true, path: targetPath, branch, baseRef: `pull/${options.pullRequestNumber}/head` }
        }
      }
    }

    const exists = await gitExec(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { timeout: 5000 })
    if (exists.status === 0) {
      const res = await gitExec(repoPath, ['worktree', 'add', targetPath, branch], { timeout: 30000 })
      if (res.status !== 0) {
        return { ok: false, error: firstErrorLine(res.stderr, res.stdout, 'git worktree add failed') }
      }
      return { ok: true, path: targetPath, branch }
    }

    // Resolve optional base ref (supporting start-from-origin bootstrap with graceful local fallback).
    const requestedBase = options?.baseBranch?.trim() || ''
    let startPoint: string | undefined
    if (options?.fromOrigin) {
      const remoteTarget = requestedBase.replace(/^origin\//, '')
      if (remoteTarget) {
        await gitExec(repoPath, ['fetch', '--quiet', 'origin', remoteTarget], { timeout: 15000 }).catch(() => {})
        const remoteRef = await gitExec(repoPath, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${remoteTarget}`], { timeout: 5000 })
        if (remoteRef.status === 0) startPoint = `origin/${remoteTarget}`
      } else {
        await gitExec(repoPath, ['fetch', '--quiet', 'origin'], { timeout: 15000 }).catch(() => {})
        const originHead = await gitExec(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { timeout: 5000 })
        if (originHead.status === 0 && originHead.stdout.trim()) {
          startPoint = originHead.stdout.trim()
        }
      }
    }
    if (!startPoint && requestedBase) {
      const refCheck = await gitExec(repoPath, ['rev-parse', '--verify', '--quiet', requestedBase], { timeout: 5000 })
      if (refCheck.status === 0) startPoint = requestedBase
    }

    const args = startPoint
      ? ['worktree', 'add', '-b', branch, targetPath, startPoint]
      : ['worktree', 'add', '-b', branch, targetPath]
    const res = await gitExec(repoPath, args, { timeout: 30000 })
    if (res.status !== 0) {
      return { ok: false, error: firstErrorLine(res.stderr, res.stdout, 'git worktree add failed') }
    }
    return { ok: true, path: targetPath, branch, ...(startPoint ? { baseRef: startPoint } : {}) }
  })
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
  return withRepoWorktreeLock(repoPath, async () => {
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
  })
}
