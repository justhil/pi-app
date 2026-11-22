import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { useUIStore } from '@renderer/stores/ui-store'
import type { GitHubIssueSummary, GitHubPullRequestSummary } from '@shared/github-status'

export function openGitHubExternal(url: string): void {
  if (!url) return
  void ipcClient.invoke('desktop.openExternal', { url }).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
  })
}

export function buildPrFixChecksPrompt(pr: GitHubPullRequestSummary): string {
  const failed = pr.checks.filter((c) => c.status === 'failed')
  const list = failed.length
    ? failed.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '- (CI checks reported failing)'
  return [
    `请帮我排查并修复 PR #${pr.number}（${pr.title}）的失败检查项：`,
    `分支：${pr.headRefName} → ${pr.baseRefName}`,
    `链接：${pr.url}`,
    '',
    '失败的 CI Checks：',
    list,
    '',
    '请先复现或查看对应测试/构建失败原因，修复后跑相关验证。',
  ].join('\n')
}

export function buildPrResolveConflictsPrompt(pr: GitHubPullRequestSummary): string {
  return [
    `请帮我解决 PR #${pr.number}（${pr.title}）与基准分支 \`${pr.baseRefName}\` 的合并冲突。`,
    `分支：${pr.headRefName} → ${pr.baseRefName}`,
    `链接：${pr.url}`,
    '',
    '请先检查冲突文件与双方改动意图，合并解决后跑 typecheck 与测试确认无回归。',
  ].join('\n')
}

export function buildPrWorkPrompt(pr: GitHubPullRequestSummary): string {
  const failed = pr.checks.filter((c) => c.status === 'failed')
  const discussions = (pr.discussions ?? []).slice(-5)
  const parts = [
    `请帮我处理 GitHub PR #${pr.number}：${pr.title}`,
    `分支：${pr.headRefName} → ${pr.baseRefName}（+${pr.additions} / -${pr.deletions}，${pr.changedFiles} 个文件）`,
    `链接：${pr.url}`,
  ]
  if (failed.length > 0) {
    parts.push('', '当前失败检查：', ...failed.map((c) => `- ${c.name}`))
  }
  if (pr.body.trim()) {
    parts.push('', 'PR 说明：', pr.body.trim().slice(0, 1400))
  }
  if (discussions.length > 0) {
    parts.push(
      '',
      '最新 Review / 评论意见：',
      ...discussions.map(
        (d) =>
          `- @${d.author}${d.reviewState ? ` [${d.reviewState}]` : ''}: ${d.body.replace(/\s+/g, ' ').slice(0, 240)}`,
      ),
    )
  }
  return parts.join('\n')
}

export function buildIssueWorkPrompt(issue: GitHubIssueSummary): string {
  const labels = issue.labels.map((l) => l.name).join(', ')
  const parts = [
    `请帮我分析并实现/修复 GitHub Issue #${issue.number}：${issue.title}`,
    `链接：${issue.url}`,
    ...(labels ? [`标签：${labels}`] : []),
  ]
  if (issue.body.trim()) {
    parts.push('', 'Issue 描述：', issue.body.trim().slice(0, 1800))
  }
  return parts.join('\n')
}

function slugifyBranch(prefix: string, number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
  return slug ? `${prefix}-${number}-${slug}` : `${prefix}-${number}`
}

export async function handoffGitHubItemToPi(opts: {
  mode: 'local' | 'worktree'
  kind: 'pr' | 'issue'
  number: number
  title: string
  prompt: string
  cwd: string
  branchHint?: string
  baseBranch?: string
  fromOrigin?: boolean
}): Promise<boolean> {
  if (opts.mode === 'worktree') {
    const branch =
      opts.kind === 'pr'
        ? `pr-${opts.number}`
        : opts.branchHint?.trim() || slugifyBranch('issue', opts.number, opts.title)
    const created = (await ipcClient.invoke('desktop.createGitWorktree', {
      workspaceId: opts.cwd,
      branch,
      baseBranch: opts.baseBranch,
      fromOrigin: opts.fromOrigin ?? true,
      ...(opts.kind === 'pr' ? { pullRequestNumber: opts.number } : {}),
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
