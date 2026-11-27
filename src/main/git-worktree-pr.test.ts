import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gitExec: vi.fn(),
  listGitWorktrees: vi.fn(),
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const mkdir = vi.fn(async () => undefined)
  return { ...actual, default: { ...actual, mkdir }, mkdir }
})
vi.mock('./git-workspace', () => ({ gitExec: mocks.gitExec, runGitReadOnly: vi.fn() }))
vi.mock('./git-worktrees', () => ({ listGitWorktrees: mocks.listGitWorktrees }))

import { createGitWorktree } from './git-worktree-ops'

const ok = { status: 0, stdout: '', stderr: '' }

describe('createGitWorktree for a pull request', () => {
  beforeEach(() => {
    mocks.gitExec.mockReset()
    mocks.listGitWorktrees.mockReset()
    mocks.gitExec.mockResolvedValue(ok)
  })

  it('reopens the worktree that already has the PR branch instead of failing', async () => {
    mocks.listGitWorktrees.mockResolvedValue({
      ok: true,
      repositoryPath: '/repo',
      trees: [
        { path: '/repo', branch: 'main', isMain: true, detached: false },
        { path: '/repo.worktrees/pr-7', branch: 'pr-7', isMain: false, detached: false },
      ],
    })

    const res = await createGitWorktree('/repo', 'pr-7', { pullRequestNumber: 7 })

    expect(res).toEqual({ ok: true, path: '/repo.worktrees/pr-7', branch: 'pr-7', baseRef: 'pull/7/head' })
    expect(mocks.gitExec.mock.calls.map((c) => c[1][0])).not.toContain('fetch')
    expect(mocks.gitExec.mock.calls.map((c) => c[1][0])).not.toContain('worktree')
  })

  it('never force-updates a local branch of the same name when fetching the PR head', async () => {
    mocks.listGitWorktrees.mockResolvedValue({
      ok: true,
      repositoryPath: '/repo',
      trees: [{ path: '/repo', branch: 'main', isMain: true, detached: false }],
    })

    await createGitWorktree('/repo', 'pr-7', { pullRequestNumber: 7 })

    const fetchCall = mocks.gitExec.mock.calls.find((c) => c[1][0] === 'fetch')
    expect(fetchCall?.[1]).toContain('refs/pull/7/head:refs/heads/pr-7')
    expect(fetchCall?.[1].some((arg: string) => arg.startsWith('+'))).toBe(false)
  })

  it('reuses a diverged local branch as is when the fast-forward fetch is refused', async () => {
    mocks.listGitWorktrees.mockResolvedValue({
      ok: true,
      repositoryPath: '/repo',
      trees: [{ path: '/repo', branch: 'main', isMain: true, detached: false }],
    })
    mocks.gitExec.mockImplementation(async (_cwd: string, args: string[]) =>
      args[0] === 'fetch' ? { status: 1, stdout: '', stderr: 'rejected (non-fast-forward)' } : ok,
    )

    const res = await createGitWorktree('/repo', 'pr-7', { pullRequestNumber: 7 })

    expect(res.ok).toBe(true)
    const add = mocks.gitExec.mock.calls.find((c) => c[1][0] === 'worktree')
    expect(add?.[1]).toEqual(['worktree', 'add', expect.stringContaining('pr-7'), 'pr-7'])
  })
})
