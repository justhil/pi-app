import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { groupGitHubChecks, type GitHubIssueSummary, type GitHubPullRequestSummary } from '@shared/github-status'

export function openGitHubExternal(url: string): void {
  if (!url) return
  void ipcClient.invoke('shell.openExternal', { url }).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
  })
}

export function buildPrFixChecksPrompt(pr: GitHubPullRequestSummary): string {
  const { attention } = groupGitHubChecks(pr.checks)
  const list = attention
    .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}${c.url ? ` (${c.url})` : ''}`)
    .join('\n')
  return [
    `Investigate and fix the failing CI checks on PR #${pr.number} (${pr.title}).`,
    `Branch: ${pr.headRefName} -> ${pr.baseRefName}`,
    `URL: ${pr.url}`,
    list ? `\nFailing checks:\n${list}` : '',
    `\nPlease inspect the failures, fix the root cause, and run relevant verification locally.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildPrResolveConflictsPrompt(pr: GitHubPullRequestSummary): string {
  return [
    `Resolve merge conflicts for PR #${pr.number} (${pr.title}).`,
    `Branch: ${pr.headRefName} -> ${pr.baseRefName}`,
    `URL: ${pr.url}`,
    `\nPlease inspect the conflicting files against ${pr.baseRefName}, resolve conflicts cleanly without losing intent, and verify tests/typecheck pass.`,
  ].join('\n')
}

export function buildPrWorkPrompt(pr: GitHubPullRequestSummary): string {
  const snippet = pr.body.trim().slice(0, 1200)
  return [
    `Work on Pull Request #${pr.number}: ${pr.title}`,
    `Branch: ${pr.headRefName} -> ${pr.baseRefName} | State: ${pr.state}${pr.isDraft ? ' (draft)' : ''}`,
    `Diff: +${pr.additions} -${pr.deletions} across ${pr.changedFiles} files | URL: ${pr.url}`,
    snippet ? `\nDescription:\n${snippet}` : '',
    `\nPlease review the PR context and current diff, summarize findings or proceed with required fixes.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildIssueWorkPrompt(issue: GitHubIssueSummary): string {
  const snippet = issue.body.trim().slice(0, 1500)
  const labels = issue.labels.map((l) => l.name).join(', ')
  return [
    `Work on Issue #${issue.number}: ${issue.title}`,
    `State: ${issue.state}${labels ? ` | Labels: ${labels}` : ''} | URL: ${issue.url}`,
    snippet ? `\nDetails:\n${snippet}` : '',
    `\nPlease inspect the relevant code, propose or implement a clean fix, and verify with tests.`,
  ]
    .filter(Boolean)
    .join('\n')
}

function slugTitle(prefix: string, num: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug ? `${prefix}-${num}-${slug}` : `${prefix}-${num}`
}

export async function handoffGitHubItemToPi(opts: {
  cwd: string
  mode: 'local' | 'worktree'
  number: number
  title: string
  prompt: string
  branchHint?: string
  baseBranch?: string
  fromOrigin?: boolean
  kind: 'pr' | 'issue'
}): Promise<boolean> {
  if (opts.mode === 'worktree') {
    const branch = opts.branchHint?.trim() || slugTitle(opts.kind, opts.number, opts.title)
    const created = (await ipcClient.invoke('desktop.createGitWorktree', {
      workspaceId: opts.cwd,
      branch,
      ...(opts.baseBranch ? { baseBranch: opts.baseBranch } : {}),
      ...(opts.fromOrigin ? { fromOrigin: true } : {}),
    })) as { ok?: boolean; path?: string; error?: string }
    if (!created?.ok || !created.path) {
      toast.error(created?.error || i18n.t('composer:worktree.createFailed'))
      return false
    }
    window.dispatchEvent(new CustomEvent('pi-desktop:sidebar-reload'))
    await activateWorkspace(created.path, { preferHome: true })
    useUIStore.getState().setComposerPrefill(opts.prompt)
    toast.success(i18n.t('common:github.worktreeReady', { number: opts.number }))
    return true
  }

  useUIStore.getState().setComposerPrefill(opts.prompt)
  toast.success(i18n.t('common:github.promptPrepared', { number: opts.number }))
  return true
}

export function formatShortRelativeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60_000))
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d`
  return `${Math.floor(diffDay / 30)}mo`
}
