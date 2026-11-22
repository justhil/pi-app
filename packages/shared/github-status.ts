export interface GitHubRepoRef {
  host: string
  owner: string
  repo: string
  fullName: string
}

export type GitHubCheckStatus = 'passed' | 'failed' | 'pending' | 'skipped'
export type GitHubChecksState = 'passing' | 'failing' | 'pending' | 'none'

export interface GitHubCheckItem {
  name: string
  status: GitHubCheckStatus
  description?: string | null
  url?: string | null
}

export interface GitHubLabel {
  name: string
  color?: string | null
}

export interface GitHubActor {
  login: string
  avatarUrl?: string | null
}

export interface GitHubDiscussionItem {
  kind: 'comment' | 'review'
  author: string
  body: string
  createdAt: string
  reviewState?: string | null
}

export type GitHubReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
export type GitHubMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null

export interface GitHubPullRequestSummary {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  headRefOid?: string | null
  isCrossRepository?: boolean
  headRepositoryNameWithOwner?: string | null
  headRepositoryOwnerLogin?: string | null
  author: GitHubActor | null
  updatedAt: string
  checksState: GitHubChecksState
  checks: GitHubCheckItem[]
  reviewDecision: GitHubReviewDecision
  mergeable: GitHubMergeableState
  additions: number
  deletions: number
  changedFiles: number
  commentCount: number
  labels: GitHubLabel[]
  body: string
  discussions?: GitHubDiscussionItem[]
}

export interface GitHubIssueSummary {
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  author: GitHubActor | null
  assignees: GitHubActor[]
  updatedAt: string
  commentCount: number
  labels: GitHubLabel[]
  body: string
}

export type GitHubStatusErrorCode = 'not-git' | 'not-github' | 'no-auth' | 'api-error'

export interface GitHubBranchPrResult {
  ok: boolean
  repo?: GitHubRepoRef | null
  pr: GitHubPullRequestSummary | null
  errorCode?: GitHubStatusErrorCode
  error?: string
}

export interface GitHubListPrsResult {
  ok: boolean
  repo?: GitHubRepoRef | null
  viewerLogin?: string | null
  items: GitHubPullRequestSummary[]
  errorCode?: GitHubStatusErrorCode
  error?: string
}

export interface GitHubListIssuesResult {
  ok: boolean
  repo?: GitHubRepoRef | null
  viewerLogin?: string | null
  items: GitHubIssueSummary[]
  errorCode?: GitHubStatusErrorCode
  error?: string
}

export interface GitHubPrDetailResult {
  ok: boolean
  repo?: GitHubRepoRef | null
  pr: GitHubPullRequestSummary | null
  errorCode?: GitHubStatusErrorCode
  error?: string
}

export interface BranchHeadMatchContext {
  headBranch: string
  defaultBranch: string | null
  repoFullName: string
  expectedHeadRepoFullName?: string | null
  isCrossRepository?: boolean
}

/**
 * Strict branch-to-PR matching inspired by T3 Code's matchesBranchHeadContext:
 * 1. Never matches the repository's default branch (e.g. main/master) to stale fork PRs.
 * 2. Requires headRefName match + repository identity match (blocking unrelated external fork PRs).
 * 3. Ignores unmerged CLOSED PRs; prefers OPEN over latest MERGED.
 */
export function selectMatchingBranchPullRequest(
  candidates: readonly GitHubPullRequestSummary[],
  ctx: BranchHeadMatchContext,
): GitHubPullRequestSummary | null {
  const branch = ctx.headBranch.trim()
  if (!branch) return null
  if (ctx.defaultBranch && branch === ctx.defaultBranch) return null
  if (!ctx.defaultBranch && (branch === 'main' || branch === 'master')) return null

  const expectedRepo = (ctx.expectedHeadRepoFullName || ctx.repoFullName).toLowerCase()
  const expectedOwner = expectedRepo.split('/')[0] || ''
  const expectsCrossRepo = Boolean(ctx.isCrossRepository)

  const matching = candidates.filter((pr) => {
    if (pr.headRefName !== branch) return false
    if (pr.state === 'closed') return false

    const prHeadRepo = pr.headRepositoryNameWithOwner?.toLowerCase() || null
    const prHeadOwner =
      pr.headRepositoryOwnerLogin?.toLowerCase() || prHeadRepo?.split('/')[0] || null

    if (prHeadRepo && prHeadRepo !== expectedRepo) return false
    if (!prHeadRepo && prHeadOwner && expectedOwner && prHeadOwner !== expectedOwner) return false

    if (expectsCrossRepo) {
      if (pr.isCrossRepository === false) return false
    } else if (pr.isCrossRepository === true) {
      if (!prHeadRepo || prHeadRepo !== expectedRepo) return false
    }
    return true
  })

  return matching.find((p) => p.state === 'open') ?? matching.find((p) => p.state === 'merged') ?? null
}

export function parseGitHubRemoteUrl(rawUrl: string): GitHubRepoRef | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  const scpMatch = trimmed.match(/^[^@]+@([^:/]+):([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (scpMatch) {
    const host = scpMatch[1].toLowerCase()
    const owner = scpMatch[2]
    const repo = scpMatch[3].replace(/\.git$/, '')
    if (!owner || !repo || repo.includes('/')) return null
    return { host, owner, repo, fullName: `${owner}/${repo}` }
  }
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) return null
    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/, '')
    if (!owner || !repo) return null
    return { host, owner, repo, fullName: `${owner}/${repo}` }
  } catch {
    return null
  }
}

export function isLikelyGitHubHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'github.com' || h.endsWith('.ghe.com') || h.includes('github')
}

export function groupGitHubChecks(checks: readonly GitHubCheckItem[]): {
  attention: GitHubCheckItem[]
  running: GitHubCheckItem[]
  passed: GitHubCheckItem[]
} {
  const attention: GitHubCheckItem[] = []
  const running: GitHubCheckItem[] = []
  const passed: GitHubCheckItem[] = []
  for (const c of checks) {
    if (c.status === 'failed') attention.push(c)
    else if (c.status === 'pending') running.push(c)
    else passed.push(c)
  }
  return { attention, running, passed }
}
