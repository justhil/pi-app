import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  isLikelyGitHubHost,
  parseGitHubRemoteUrl,
  selectMatchingBranchPullRequest,
  type GitHubBranchPrResult,
  type GitHubCheckItem,
  type GitHubChecksState,
  type GitHubCheckStatus,
  type GitHubIssueSummary,
  type GitHubListIssuesResult,
  type GitHubListPrsResult,
  type GitHubMergeableState,
  type GitHubPrDetailResult,
  type GitHubPullRequestSummary,
  type GitHubRepoRef,
  type GitHubReviewDecision,
} from '@shared/github-status'
import { runGitReadOnly } from './git-workspace'

const execFileAsync = promisify(execFile)

/** Cap concurrent gh CLI / API queries to prevent secondary GitHub rate limits across worktrees. */
const MAX_CONCURRENCY = 4
let activeOps = 0
const waitQueue: Array<() => void> = []

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeOps >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waitQueue.push(resolve))
  }
  activeOps++
  try {
    return await fn()
  } finally {
    activeOps--
    const next = waitQueue.shift()
    if (next) next()
  }
}

const TOKEN_TTL_MS = 5 * 60 * 1000
const MISSING_TOKEN_TTL_MS = 15 * 1000
const RESPONSE_TTL_MS = 45 * 1000

const tokenCache = new Map<string, { token: string | null; expiresAt: number }>()
const dataCache = new Map<string, { value: unknown; expiresAt: number }>()
const viewerCache = new Map<string, { login: string | null; expiresAt: number }>()

function readCache<T>(key: string, force?: boolean): T | null {
  if (force) return null
  const entry = dataCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    dataCache.delete(key)
    return null
  }
  return entry.value as T
}

function writeCache(key: string, value: unknown, ttlMs = RESPONSE_TTL_MS): void {
  dataCache.set(key, { value, expiresAt: Date.now() + ttlMs })
  if (dataCache.size > 120) {
    const oldest = dataCache.keys().next().value
    if (oldest) dataCache.delete(oldest)
  }
}

export function clearGitHubStatusCaches(): void {
  tokenCache.clear()
  dataCache.clear()
  viewerCache.clear()
}

export async function resolveGitHubRepo(cwd: string): Promise<
  | { ok: true; repo: GitHubRepoRef }
  | { ok: false; errorCode: 'not-git' | 'not-github'; error: string }
> {
  const origin = await runGitReadOnly(cwd, ['remote', 'get-url', 'origin'], { timeout: 3000 })
  let remoteUrl = origin.ok ? origin.stdout.trim() : ''
  if (!remoteUrl) {
    if (!origin.ok && origin.notRepo) {
      return { ok: false, errorCode: 'not-git', error: 'Not a Git repository' }
    }
    const remotes = await runGitReadOnly(cwd, ['remote'], { timeout: 3000 })
    const first = remotes.ok ? remotes.stdout.trim().split(/\r?\n/).find(Boolean) : ''
    if (first) {
      const r = await runGitReadOnly(cwd, ['remote', 'get-url', first], { timeout: 3000 })
      if (r.ok) remoteUrl = r.stdout.trim()
    }
  }
  if (!remoteUrl) {
    return { ok: false, errorCode: 'not-github', error: 'No Git remote configured' }
  }
  const parsed = parseGitHubRemoteUrl(remoteUrl)
  if (!parsed || !isLikelyGitHubHost(parsed.host)) {
    return { ok: false, errorCode: 'not-github', error: 'Remote is not a GitHub repository' }
  }
  return { ok: true, repo: parsed }
}

async function resolveGitHubToken(host: string): Promise<string | null> {
  const cached = tokenCache.get(host)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const envToken = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()
  if (envToken) {
    tokenCache.set(host, { token: envToken, expiresAt: Date.now() + TOKEN_TTL_MS })
    return envToken
  }

  try {
    const res = await withConcurrencyLimit(() =>
      execFileAsync('gh', ['auth', 'token', '--hostname', host], {
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }),
    )
    const token = res.stdout.trim()
    if (token) {
      tokenCache.set(host, { token, expiresAt: Date.now() + TOKEN_TTL_MS })
      return token
    }
  } catch {
    /* gh missing or unauthenticated */
  }
  tokenCache.set(host, { token: null, expiresAt: Date.now() + MISSING_TOKEN_TTL_MS })
  return null
}

function graphqlEndpoint(host: string): string {
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`
}

async function queryGitHubGraphQL<T>(
  host: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  return withConcurrencyLimit(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const res = await fetch(graphqlEndpoint(host), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'User-Agent': 'pi-desktop',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })
      if (res.status === 401 || res.status === 403) {
        tokenCache.delete(host)
      }
      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}`)
      }
      const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> }
      if (json.errors?.length && !json.data) {
        throw new Error(json.errors[0]?.message || 'GitHub GraphQL error')
      }
      if (!json.data) throw new Error('Empty GitHub response')
      return json.data
    } finally {
      clearTimeout(timer)
    }
  })
}

async function resolveViewerLogin(host: string, token: string): Promise<string | null> {
  const cached = viewerCache.get(host)
  if (cached && cached.expiresAt > Date.now()) return cached.login
  try {
    const data = await queryGitHubGraphQL<{ viewer?: { login?: string } }>(
      host,
      token,
      'query { viewer { login } }',
      {},
    )
    const login = data.viewer?.login ?? null
    viewerCache.set(host, { login, expiresAt: Date.now() + TOKEN_TTL_MS })
    return login
  } catch {
    return null
  }
}

function mapCheckContext(node: Record<string, unknown>): GitHubCheckItem | null {
  const typeName = String(node.__typename || '')
  if (typeName === 'CheckRun') {
    const name = String(node.name || 'Check')
    const rawStatus = String(node.status || '').toUpperCase()
    const conclusion = String(node.conclusion || '').toUpperCase()
    let status: GitHubCheckStatus = 'pending'
    if (rawStatus === 'COMPLETED') {
      if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') status = 'passed'
      else if (conclusion === 'SKIPPED') status = 'skipped'
      else status = 'failed'
    }
    return {
      name,
      status,
      description: typeof node.title === 'string' && node.title ? node.title : null,
      url: typeof node.detailsUrl === 'string' ? node.detailsUrl : null,
    }
  }
  if (typeName === 'StatusContext') {
    const name = String(node.context || 'Status')
    const rawState = String(node.state || '').toUpperCase()
    const status: GitHubCheckStatus =
      rawState === 'SUCCESS'
        ? 'passed'
        : rawState === 'FAILURE' || rawState === 'ERROR'
          ? 'failed'
          : 'pending'
    return {
      name,
      status,
      description: typeof node.description === 'string' ? node.description : null,
      url: typeof node.targetUrl === 'string' ? node.targetUrl : null,
    }
  }
  return null
}

function summarizeChecksState(rollupState: unknown, checks: GitHubCheckItem[]): GitHubChecksState {
  const raw = typeof rollupState === 'string' ? rollupState.toUpperCase() : ''
  if (raw === 'SUCCESS') return 'passing'
  if (raw === 'FAILURE' || raw === 'ERROR') return 'failing'
  if (raw === 'PENDING' || raw === 'EXPECTED') return 'pending'
  if (checks.some((c) => c.status === 'failed')) return 'failing'
  if (checks.some((c) => c.status === 'pending')) return 'pending'
  if (checks.some((c) => c.status === 'passed')) return 'passing'
  return 'none'
}

function mapPullRequestNode(node: Record<string, unknown>): GitHubPullRequestSummary {
  const rawState = String(node.state || 'OPEN').toUpperCase()
  const state: 'open' | 'closed' | 'merged' =
    rawState === 'MERGED' ? 'merged' : rawState === 'CLOSED' ? 'closed' : 'open'
  const commits = node.commits as { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string; contexts?: { nodes?: Record<string, unknown>[] } } } }> } | undefined
  const rollup = commits?.nodes?.[0]?.commit?.statusCheckRollup
  const rawContexts = rollup?.contexts?.nodes ?? []
  const checks = rawContexts.map(mapCheckContext).filter((c): c is GitHubCheckItem => c !== null)
  const checksState = summarizeChecksState(rollup?.state, checks)
  const rawAuthor = node.author as { login?: string; avatarUrl?: string } | null | undefined
  const rawLabels = (node.labels as { nodes?: Array<{ name?: string; color?: string }> } | undefined)?.nodes ?? []
  const rawComments = node.comments as {
    totalCount?: number
    nodes?: Array<{ author?: { login?: string } | null; body?: string; createdAt?: string }>
  } | undefined
  const rawReviews = node.reviews as {
    nodes?: Array<{ author?: { login?: string } | null; body?: string; state?: string; submittedAt?: string }>
  } | undefined
  const discussions: Array<{
    kind: 'comment' | 'review'
    author: string
    body: string
    createdAt: string
    reviewState?: string | null
  }> = []
  for (const c of rawComments?.nodes ?? []) {
    const body = String(c?.body || '').trim()
    if (!body) continue
    discussions.push({
      kind: 'comment',
      author: c?.author?.login || 'ghost',
      body: body.slice(0, 1200),
      createdAt: String(c?.createdAt || ''),
    })
  }
  for (const r of rawReviews?.nodes ?? []) {
    const body = String(r?.body || '').trim()
    const st = String(r?.state || '')
    if (!body && st === 'COMMENTED') continue
    discussions.push({
      kind: 'review',
      author: r?.author?.login || 'ghost',
      body: body.slice(0, 1200),
      createdAt: String(r?.submittedAt || ''),
      reviewState: st || null,
    })
  }
  discussions.sort((a, b) => Date.parse(a.createdAt || '0') - Date.parse(b.createdAt || '0'))
  const rawReview = node.reviewDecision
  const reviewDecision: GitHubReviewDecision =
    rawReview === 'APPROVED' || rawReview === 'CHANGES_REQUESTED' || rawReview === 'REVIEW_REQUIRED'
      ? rawReview
      : null
  const rawMergeable = node.mergeable
  const mergeable: GitHubMergeableState =
    rawMergeable === 'MERGEABLE' || rawMergeable === 'CONFLICTING' || rawMergeable === 'UNKNOWN'
      ? rawMergeable
      : null

  const headRepo = node.headRepository as { nameWithOwner?: string } | null | undefined
  const headRepoOwner = node.headRepositoryOwner as { login?: string } | null | undefined

  return {
    number: Number(node.number || 0),
    title: String(node.title || ''),
    url: String(node.url || ''),
    state,
    isDraft: Boolean(node.isDraft),
    headRefName: String(node.headRefName || ''),
    baseRefName: String(node.baseRefName || ''),
    headRefOid: typeof node.headRefOid === 'string' ? node.headRefOid : null,
    isCrossRepository: typeof node.isCrossRepository === 'boolean' ? node.isCrossRepository : undefined,
    headRepositoryNameWithOwner: headRepo?.nameWithOwner ?? null,
    headRepositoryOwnerLogin: headRepoOwner?.login ?? null,
    author: rawAuthor?.login ? { login: rawAuthor.login, avatarUrl: rawAuthor.avatarUrl ?? null } : null,
    updatedAt: String(node.updatedAt || ''),
    checksState,
    checks,
    reviewDecision,
    mergeable,
    additions: Number(node.additions || 0),
    deletions: Number(node.deletions || 0),
    changedFiles: Number(node.changedFiles || 0),
    commentCount: Number(rawComments?.totalCount || 0),
    labels: rawLabels.filter((l) => l.name).map((l) => ({ name: l.name!, color: l.color ?? null })),
    body: String(node.body || ''),
    ...(discussions.length > 0 ? { discussions: discussions.slice(-10) } : {}),
  }
}

const PR_FIELDS_WITH_CHECKS = `
  number
  title
  url
  state
  isDraft
  headRefName
  baseRefName
  headRefOid
  isCrossRepository
  headRepository { nameWithOwner }
  headRepositoryOwner { login }
  updatedAt
  additions
  deletions
  changedFiles
  reviewDecision
  mergeable
  body
  author { login avatarUrl }
  comments(last: 8) { totalCount nodes { author { login } body createdAt } }
  reviews(last: 8) { nodes { author { login } body state submittedAt } }
  labels(first: 8) { nodes { name color } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 40) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion title detailsUrl }
              ... on StatusContext { context state description targetUrl }
            }
          }
        }
      }
    }
  }
`

const PR_FIELDS_COMPACT = `
  number
  title
  url
  state
  isDraft
  headRefName
  baseRefName
  updatedAt
  additions
  deletions
  changedFiles
  reviewDecision
  mergeable
  body
  author { login avatarUrl }
  comments { totalCount }
  labels(first: 6) { nodes { name color } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup { state }
      }
    }
  }
`

export async function readBranchPullRequest(
  cwd: string,
  branch: string,
  force?: boolean,
): Promise<GitHubBranchPrResult> {
  const repoRes = await resolveGitHubRepo(cwd)
  if (!repoRes.ok) return { ok: false, pr: null, errorCode: repoRes.errorCode, error: repoRes.error }
  const { repo } = repoRes
  const cacheKey = `branchPr:${repo.host}:${repo.fullName}:${branch}`
  const cached = readCache<GitHubBranchPrResult>(cacheKey, force)
  if (cached) return cached

  const token = await resolveGitHubToken(repo.host)
  if (!token) return { ok: false, repo, pr: null, errorCode: 'no-auth', error: 'No GitHub credential' }

  try {
    let expectedHeadRepoFullName = repo.fullName
    let isCrossRepository = false
    const upstream = await runGitReadOnly(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      timeout: 2500,
    })
    if (upstream.ok && upstream.stdout.trim().includes('/')) {
      const remoteName = upstream.stdout.trim().split('/')[0]
      if (remoteName && remoteName !== 'origin') {
        const remUrl = await runGitReadOnly(cwd, ['remote', 'get-url', remoteName], { timeout: 2500 })
        const parsedUpstream = remUrl.ok ? parseGitHubRemoteUrl(remUrl.stdout.trim()) : null
        if (parsedUpstream) {
          expectedHeadRepoFullName = parsedUpstream.fullName
          isCrossRepository = parsedUpstream.fullName.toLowerCase() !== repo.fullName.toLowerCase()
        }
      }
    }

    const query = `
      query($owner: String!, $repo: String!, $head: String!) {
        repository(owner: $owner, name: $repo) {
          defaultBranchRef { name }
          pullRequests(headRefName: $head, first: 10, states: [OPEN, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { ${PR_FIELDS_WITH_CHECKS} }
          }
        }
      }
    `
    const data = await queryGitHubGraphQL<{
      repository?: {
        defaultBranchRef?: { name?: string } | null
        pullRequests?: { nodes?: Record<string, unknown>[] }
      }
    }>(repo.host, token, query, { owner: repo.owner, repo: repo.repo, head: branch })
    const defaultBranch = data.repository?.defaultBranchRef?.name ?? null
    const nodes = data.repository?.pullRequests?.nodes ?? []
    const mapped = nodes.map(mapPullRequestNode)
    const best = selectMatchingBranchPullRequest(mapped, {
      headBranch: branch,
      defaultBranch,
      repoFullName: repo.fullName,
      expectedHeadRepoFullName,
      isCrossRepository,
    })
    const out: GitHubBranchPrResult = { ok: true, repo, pr: best }
    writeCache(cacheKey, out, best?.checksState === 'pending' ? 18_000 : RESPONSE_TTL_MS)
    return out
  } catch (e) {
    return {
      ok: false,
      repo,
      pr: null,
      errorCode: 'api-error',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function readPullRequestDetail(
  cwd: string,
  number: number,
  force?: boolean,
): Promise<GitHubPrDetailResult> {
  const repoRes = await resolveGitHubRepo(cwd)
  if (!repoRes.ok) return { ok: false, pr: null, errorCode: repoRes.errorCode, error: repoRes.error }
  const { repo } = repoRes
  const cacheKey = `prDetail:${repo.host}:${repo.fullName}:${number}`
  const cached = readCache<GitHubPrDetailResult>(cacheKey, force)
  if (cached) return cached

  const token = await resolveGitHubToken(repo.host)
  if (!token) return { ok: false, repo, pr: null, errorCode: 'no-auth', error: 'No GitHub credential' }

  try {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) { ${PR_FIELDS_WITH_CHECKS} }
        }
      }
    `
    const data = await queryGitHubGraphQL<{
      repository?: { pullRequest?: Record<string, unknown> | null }
    }>(repo.host, token, query, { owner: repo.owner, repo: repo.repo, number })
    const pr = data.repository?.pullRequest ? mapPullRequestNode(data.repository.pullRequest) : null
    const out: GitHubPrDetailResult = { ok: true, repo, pr }
    writeCache(cacheKey, out, pr?.checksState === 'pending' ? 18_000 : RESPONSE_TTL_MS)
    return out
  } catch (e) {
    return {
      ok: false,
      repo,
      pr: null,
      errorCode: 'api-error',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function listRepoPullRequests(
  cwd: string,
  opts: {
    state?: 'open' | 'closed' | 'all'
    involvement?: 'all' | 'authored' | 'assigned' | 'involved'
    search?: string
    force?: boolean
  } = {},
): Promise<GitHubListPrsResult> {
  const repoRes = await resolveGitHubRepo(cwd)
  if (!repoRes.ok) return { ok: false, items: [], errorCode: repoRes.errorCode, error: repoRes.error }
  const { repo } = repoRes
  const state = opts.state ?? 'open'
  const involvement = opts.involvement ?? 'all'
  const searchTerm = (opts.search ?? '').trim()
  const cacheKey = `listPrs:${repo.host}:${repo.fullName}:${state}:${involvement}:${searchTerm}`
  const cached = readCache<GitHubListPrsResult>(cacheKey, opts.force)
  if (cached) return cached

  const token = await resolveGitHubToken(repo.host)
  if (!token) return { ok: false, repo, items: [], errorCode: 'no-auth', error: 'No GitHub credential' }

  try {
    const viewerLogin = await resolveViewerLogin(repo.host, token)
    const parts = [`repo:${repo.fullName}`, 'is:pr']
    if (state === 'open') parts.push('is:open')
    else if (state === 'closed') parts.push('is:closed')
    if (viewerLogin && involvement === 'authored') parts.push(`author:${viewerLogin}`)
    else if (viewerLogin && involvement === 'assigned') parts.push(`assignee:${viewerLogin}`)
    else if (viewerLogin && involvement === 'involved') parts.push(`involves:${viewerLogin}`)
    if (searchTerm) parts.push(searchTerm)
    parts.push('sort:updated-desc')

    const query = `
      query($q: String!) {
        search(query: $q, type: ISSUE, first: 40) {
          nodes {
            ... on PullRequest { ${PR_FIELDS_COMPACT} }
          }
        }
      }
    `
    const data = await queryGitHubGraphQL<{ search?: { nodes?: Record<string, unknown>[] } }>(
      repo.host,
      token,
      query,
      { q: parts.join(' ') },
    )
    const items = (data.search?.nodes ?? [])
      .filter((n) => n && typeof n.number === 'number')
      .map(mapPullRequestNode)
    const out: GitHubListPrsResult = { ok: true, repo, viewerLogin, items }
    writeCache(cacheKey, out)
    return out
  } catch (e) {
    return {
      ok: false,
      repo,
      items: [],
      errorCode: 'api-error',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function listRepoIssues(
  cwd: string,
  opts: {
    state?: 'open' | 'closed' | 'all'
    involvement?: 'all' | 'authored' | 'assigned' | 'involved'
    search?: string
    force?: boolean
  } = {},
): Promise<GitHubListIssuesResult> {
  const repoRes = await resolveGitHubRepo(cwd)
  if (!repoRes.ok) return { ok: false, items: [], errorCode: repoRes.errorCode, error: repoRes.error }
  const { repo } = repoRes
  const state = opts.state ?? 'open'
  const involvement = opts.involvement ?? 'all'
  const searchTerm = (opts.search ?? '').trim()
  const cacheKey = `listIssues:${repo.host}:${repo.fullName}:${state}:${involvement}:${searchTerm}`
  const cached = readCache<GitHubListIssuesResult>(cacheKey, opts.force)
  if (cached) return cached

  const token = await resolveGitHubToken(repo.host)
  if (!token) return { ok: false, repo, items: [], errorCode: 'no-auth', error: 'No GitHub credential' }

  try {
    const viewerLogin = await resolveViewerLogin(repo.host, token)
    const parts = [`repo:${repo.fullName}`, 'is:issue']
    if (state === 'open') parts.push('is:open')
    else if (state === 'closed') parts.push('is:closed')
    if (viewerLogin && involvement === 'authored') parts.push(`author:${viewerLogin}`)
    else if (viewerLogin && involvement === 'assigned') parts.push(`assignee:${viewerLogin}`)
    else if (viewerLogin && involvement === 'involved') parts.push(`involves:${viewerLogin}`)
    if (searchTerm) parts.push(searchTerm)
    parts.push('sort:updated-desc')

    const query = `
      query($q: String!) {
        search(query: $q, type: ISSUE, first: 40) {
          nodes {
            ... on Issue {
              number
              title
              url
              state
              updatedAt
              body
              author { login avatarUrl }
              assignees(first: 4) { nodes { login avatarUrl } }
              comments { totalCount }
              labels(first: 6) { nodes { name color } }
            }
          }
        }
      }
    `
    const data = await queryGitHubGraphQL<{ search?: { nodes?: Record<string, unknown>[] } }>(
      repo.host,
      token,
      query,
      { q: parts.join(' ') },
    )
    const items: GitHubIssueSummary[] = (data.search?.nodes ?? [])
      .filter((n) => n && typeof n.number === 'number')
      .map((n) => {
        const rawAuthor = n.author as { login?: string; avatarUrl?: string } | null | undefined
        const rawAssignees = (n.assignees as { nodes?: Array<{ login?: string; avatarUrl?: string }> } | undefined)?.nodes ?? []
        const rawLabels = (n.labels as { nodes?: Array<{ name?: string; color?: string }> } | undefined)?.nodes ?? []
        const rawComments = n.comments as { totalCount?: number } | undefined
        return {
          number: Number(n.number || 0),
          title: String(n.title || ''),
          url: String(n.url || ''),
          state: String(n.state || 'OPEN').toUpperCase() === 'CLOSED' ? 'closed' : 'open',
          author: rawAuthor?.login ? { login: rawAuthor.login, avatarUrl: rawAuthor.avatarUrl ?? null } : null,
          assignees: rawAssignees
            .filter((a) => a.login)
            .map((a) => ({ login: a.login!, avatarUrl: a.avatarUrl ?? null })),
          updatedAt: String(n.updatedAt || ''),
          commentCount: Number(rawComments?.totalCount || 0),
          labels: rawLabels.filter((l) => l.name).map((l) => ({ name: l.name!, color: l.color ?? null })),
          body: String(n.body || ''),
        }
      })
    const out: GitHubListIssuesResult = { ok: true, repo, viewerLogin, items }
    writeCache(cacheKey, out)
    return out
  } catch (e) {
    return {
      ok: false,
      repo,
      items: [],
      errorCode: 'api-error',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
