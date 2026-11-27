import { describe, expect, it, vi } from 'vitest'
import { withRepoWorktreeLock } from './git-worktree-ops'
import {
  groupGitHubChecks,
  isLikelyGitHubHost,
  parseGitHubRemoteUrl,
  selectMatchingBranchPullRequest,
  type GitHubPullRequestSummary,
} from '@shared/github-status'

vi.mock('./git-workspace', () => ({
  gitExec: vi.fn(),
  runGitReadOnly: vi.fn(),
}))
vi.mock('./git-worktrees', () => ({
  listGitWorktrees: vi.fn(),
}))

describe('Main worktree queue lock & GitHub URL helpers', () => {
  it('serializes concurrent worktree mutations on the same repository', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r
    })

    const p1 = withRepoWorktreeLock('D:/repo', async () => {
      order.push('start-1')
      await firstGate
      order.push('end-1')
      return 1
    })
    const p2 = withRepoWorktreeLock('d:\\repo\\', async () => {
      order.push('start-2')
      order.push('end-2')
      return 2
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['start-1'])
    releaseFirst()
    await expect(Promise.all([p1, p2])).resolves.toEqual([1, 2])
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('parses HTTPS and SSH GitHub remote URLs and groups checks attention-first', () => {
    expect(parseGitHubRemoteUrl('git@github.com:pingdotgg/t3code.git')).toEqual({
      host: 'github.com',
      owner: 'pingdotgg',
      repo: 't3code',
      fullName: 'pingdotgg/t3code',
    })
    expect(parseGitHubRemoteUrl('https://github.com/justhiL/pi-app.git')).toEqual({
      host: 'github.com',
      owner: 'justhiL',
      repo: 'pi-app',
      fullName: 'justhiL/pi-app',
    })
    expect(isLikelyGitHubHost('github.com')).toBe(true)

    const grouped = groupGitHubChecks([
      { name: 'lint', status: 'passed' },
      { name: 'build', status: 'pending' },
      { name: 'test', status: 'failed' },
    ])
    expect(grouped.attention.map((c) => c.name)).toEqual(['test'])
    expect(grouped.running.map((c) => c.name)).toEqual(['build'])
    expect(grouped.passed.map((c) => c.name)).toEqual(['lint'])
  })

  it('matches branch PRs strictly: never attaches default branch or unrelated external fork/closed PRs', () => {
    const mkPr = (overrides: Partial<GitHubPullRequestSummary>): GitHubPullRequestSummary => ({
      number: 1,
      title: 'Test PR',
      url: 'https://github.com/justhiL/pi-app/pull/1',
      state: 'open',
      isDraft: false,
      headRefName: 'main',
      baseRefName: 'main',
      isCrossRepository: false,
      headRepositoryNameWithOwner: 'justhiL/pi-app',
      headRepositoryOwnerLogin: 'justhiL',
      author: { login: 'justhiL' },
      updatedAt: '2026-01-01T00:00:00Z',
      checksState: 'passing',
      checks: [],
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      additions: 10,
      deletions: 2,
      changedFiles: 1,
      commentCount: 0,
      labels: [],
      body: '',
      ...overrides,
    })

    // 1. Default branch 'main' must NEVER match a stale external fork PR #57 (main -> main)
    const staleForkMainPr = mkPr({
      number: 57,
      state: 'closed',
      headRefName: 'main',
      baseRefName: 'main',
      isCrossRepository: true,
      headRepositoryNameWithOwner: 'someone-else/pi-app',
      headRepositoryOwnerLogin: 'someone-else',
    })
    expect(
      selectMatchingBranchPullRequest([staleForkMainPr], {
        headBranch: 'main',
        defaultBranch: 'main',
        repoFullName: 'justhiL/pi-app',
      }),
    ).toBeNull()

    // 2. Feature branch ignores unrelated cross-repo fork PR & closed PR, picks same-repo open PR
    const forkFeaturePr = mkPr({
      number: 88,
      state: 'open',
      headRefName: 'feat/worktrees',
      isCrossRepository: true,
      headRepositoryNameWithOwner: 'other-user/pi-app',
      headRepositoryOwnerLogin: 'other-user',
    })
    const closedOwnPr = mkPr({
      number: 89,
      state: 'closed',
      headRefName: 'feat/worktrees',
      isCrossRepository: false,
      headRepositoryNameWithOwner: 'justhiL/pi-app',
    })
    const openOwnPr = mkPr({
      number: 90,
      state: 'open',
      headRefName: 'feat/worktrees',
      isCrossRepository: false,
      headRepositoryNameWithOwner: 'justhiL/pi-app',
    })
    expect(
      selectMatchingBranchPullRequest([forkFeaturePr, closedOwnPr, openOwnPr], {
        headBranch: 'feat/worktrees',
        defaultBranch: 'main',
        repoFullName: 'justhiL/pi-app',
      })?.number,
    ).toBe(90)
  })
})
