import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  XCircle,
} from '@renderer/components/icons'
import type { GitWorktree } from '@shared/git-worktree'
import type { GitHubPullRequestSummary } from '@shared/github-status'
import { workspacePathsEqual } from '@shared/workspace-path'
import { AnimatedHeight } from '@renderer/components/ui/animated-height'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { openTerminalTab } from '@renderer/features/terminal/terminal-drawer'
import { useUIStore } from '@renderer/stores/ui-store'
import { slugifyWorktreeBranchFromPrompt } from '@renderer/stores/draft-worktree-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { SessionRunningPixelGrid } from '@renderer/features/workspace/session-running-pixel-grid'
import { cn } from '@renderer/lib/utils'

interface RunningSessionRef {
  sessionId: string
  sessionFile: string
}

interface EnrichedWorktree extends GitWorktree {
  dirtyCount: number
  ahead: number
  behind: number
  runningCount: number
  runningSessions?: RunningSessionRef[]
  isCleanIdle?: boolean
}

interface BranchRef {
  name: string
  remote: boolean
  current: boolean
}

type LaunchJob = {
  id: string
  branch: string
  stage: 'creating' | 'starting' | 'running' | 'failed'
  error?: string
}

/**
 * Polished Parallel Worktrees Command Panel:
 * - Single-column responsive create form (never cramped at 360px), Ctrl/Cmd+Enter launches immediately
 * - Silent background polling (15s + git-changed + focus) with manual refresh spinner only
 * - Per-worktree live running sessions direct jump, matched PR badge link to GitHubPanel,
 *   open terminal at worktree cwd, reveal in folder, copy path, and clean-idle batch cleanup
 */
export function WorktreesPanel() {
  const { t } = useTranslation()
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const openCreateSignal = usePanelIntentStore((s) => s.openWorktreeCreateSignal)
  const openGitHubPr = usePanelIntentStore((s) => s.openGitHubPr)

  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [trees, setTrees] = useState<EnrichedWorktree[]>([])
  const [prByBranch, setPrByBranch] = useState<Record<string, GitHubPullRequestSummary>>({})
  const [manualLoading, setManualLoading] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [notRepo, setNotRepo] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [fromOrigin, setFromOrigin] = useState(false)
  const [taskPrompt, setTaskPrompt] = useState('')
  const [branches, setBranches] = useState<BranchRef[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [jobs, setJobs] = useState<LaunchJob[]>([])
  const [confirmRemovePath, setConfirmRemovePath] = useState<string | null>(null)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const [confirmCleanAll, setConfirmCleanAll] = useState(false)
  const [cleaningAll, setCleaningAll] = useState(false)

  useEffect(() => {
    if (openCreateSignal > 0) setCreateOpen(true)
  }, [openCreateSignal])

  const loadWorktrees = useCallback(
    async (opts?: { showSpinner?: boolean }) => {
      if (!currentWorkspace) {
        setTrees([])
        setRepoPath(null)
        setNotRepo(false)
        setInitialLoaded(true)
        return
      }
      if (opts?.showSpinner) setManualLoading(true)
      try {
        const res = (await ipcClient.invoke('desktop.gitWorktreesDetail', {
          workspaceId: currentWorkspace,
        })) as {
          ok?: boolean
          repositoryPath?: string | null
          trees?: EnrichedWorktree[]
        }
        if (!res?.ok) {
          setNotRepo(true)
          setTrees([])
          setRepoPath(null)
        } else {
          setNotRepo(false)
          setRepoPath(res.repositoryPath ?? null)
          const list = res.trees ?? []
          setTrees(list)
          // Lazily resolve strictly matched PRs for non-main branches (cached 45s in main process)
          const nonMainBranches = list
            .filter((wt) => !wt.isMain && wt.branch)
            .map((wt) => ({ path: wt.path, branch: wt.branch! }))
            .slice(0, 6)
          if (nonMainBranches.length > 0) {
            void Promise.all(
              nonMainBranches.map(async (item) => {
                const prRes = (await ipcClient
                  .invoke('github.branchPr', { cwd: item.path, branch: item.branch })
                  .catch(() => null)) as { ok?: boolean; pr?: GitHubPullRequestSummary | null } | null
                return prRes?.ok && prRes.pr ? ([item.branch, prRes.pr] as const) : null
              }),
            ).then((pairs) => {
              const map: Record<string, GitHubPullRequestSummary> = {}
              for (const p of pairs) {
                if (p) map[p[0]] = p[1]
              }
              setPrByBranch(map)
            })
          }
        }
      } catch {
        setNotRepo(true)
        setTrees([])
      } finally {
        setInitialLoaded(true)
        if (opts?.showSpinner) setManualLoading(false)
      }
    },
    [currentWorkspace],
  )

  useEffect(() => {
    void loadWorktrees()
    if (!currentWorkspace) return
    const off = onGitWorkspaceChanged(() => void loadWorktrees())
    const onFocus = () => void loadWorktrees()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) void loadWorktrees()
    }, 15_000)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [currentWorkspace, loadWorktrees])

  useEffect(() => {
    if (!createOpen || !currentWorkspace) return
    void (
      ipcClient.invoke('git.branches', { cwd: currentWorkspace }) as Promise<{
        branches?: BranchRef[]
      }>
    )
      .then((res) => setBranches((res?.branches ?? []).filter((b) => !b.remote)))
      .catch(() => {})
  }, [createOpen, currentWorkspace])

  const handleLaunch = async () => {
    if (!currentWorkspace || submitting) return
    const prompt = taskPrompt.trim()
    const branch = branchInput.trim() || slugifyWorktreeBranchFromPrompt(prompt || 'parallel')
    const jobId = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    setSubmitting(true)
    setJobs((prev) => [{ id: jobId, branch, stage: 'creating' }, ...prev.slice(0, 3)])
    try {
      if (prompt) {
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, stage: 'starting' } : j)))
        const res = (await ipcClient.invoke('desktop.launchWorktreeTask', {
          workspaceId: currentWorkspace,
          branch,
          baseBranch: baseBranch || undefined,
          fromOrigin,
          prompt,
        })) as { ok?: boolean; path?: string; branch?: string; error?: string }
        if (!res?.ok) {
          const msg = res?.error || t('composer:worktree.createFailed')
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? { ...j, stage: 'failed', error: msg } : j)),
          )
          toast.error(msg)
          return
        }
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, stage: 'running' } : j)))
        setBranchInput('')
        setTaskPrompt('')
        window.dispatchEvent(new CustomEvent('pi-desktop:sidebar-reload'))
        toast.success(t('common:worktrees.launchedBackground', { branch: res.branch || branch }))
        void loadWorktrees()
        window.setTimeout(() => {
          setJobs((prev) => prev.filter((j) => j.id !== jobId))
        }, 4500)
      } else {
        const created = (await ipcClient.invoke('desktop.createGitWorktree', {
          workspaceId: currentWorkspace,
          branch,
          baseBranch: baseBranch || undefined,
          fromOrigin,
        })) as { ok?: boolean; path?: string; branch?: string; error?: string }
        if (!created?.ok || !created.path) {
          const msg = created?.error || t('composer:worktree.createFailed')
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? { ...j, stage: 'failed', error: msg } : j)),
          )
          toast.error(msg)
          return
        }
        setJobs((prev) => prev.filter((j) => j.id !== jobId))
        setBranchInput('')
        setCreateOpen(false)
        window.dispatchEvent(new CustomEvent('pi-desktop:sidebar-reload'))
        toast.success(t('common:branches.worktreeCreated', { branch: created.branch || branch }))
        await activateWorkspace(created.path, { preferHome: true })
        void loadWorktrees()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, stage: 'failed', error: msg } : j)),
      )
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (tree: EnrichedWorktree) => {
    if (!currentWorkspace || tree.isMain) return
    setRemovingPath(tree.path)
    try {
      const res = (await ipcClient.invoke('desktop.removeGitWorktree', {
        workspaceId: repoPath || currentWorkspace,
        worktreePath: tree.path,
      })) as { ok?: boolean; repositoryPath?: string | null; error?: string }
      if (!res?.ok) {
        toast.error(res?.error || t('common:operationFailed'))
        return
      }
      setConfirmRemovePath(null)
      toast.success(
        t('common:worktrees.removed', {
          name: tree.branch || tree.path.split(/[\\/]/).pop(),
        }),
      )
      window.dispatchEvent(new CustomEvent('pi-desktop:sidebar-reload'))
      if (workspacePathsEqual(currentWorkspace, tree.path) && (res.repositoryPath || repoPath)) {
        await activateWorkspace((res.repositoryPath || repoPath)!)
      }
      void loadWorktrees()
    } finally {
      setRemovingPath(null)
    }
  }

  const cleanIdleTrees = trees.filter(
    (wt) => wt.isCleanIdle && !workspacePathsEqual(currentWorkspace, wt.path),
  )

  const handleCleanAllIdle = async () => {
    if (cleaningAll || cleanIdleTrees.length === 0 || !currentWorkspace) return
    setCleaningAll(true)
    let removed = 0
    try {
      for (const wt of cleanIdleTrees) {
        const res = (await ipcClient.invoke('desktop.removeGitWorktree', {
          workspaceId: repoPath || currentWorkspace,
          worktreePath: wt.path,
        })) as { ok?: boolean }
        if (res?.ok) removed++
      }
      setConfirmCleanAll(false)
      if (removed > 0) {
        toast.success(t('common:worktrees.cleanedIdle', { count: removed }))
        window.dispatchEvent(new CustomEvent('pi-desktop:sidebar-reload'))
        void loadWorktrees()
      }
    } finally {
      setCleaningAll(false)
    }
  }

  const totalRunning = trees.reduce((sum, item) => sum + item.runningCount, 0)

  return (
    <div data-pi-slot="worktrees-panel" className="flex h-full min-h-0 flex-col text-[12.5px]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[12.5px] font-semibold text-foreground">
            {t('common:panel.worktrees')}
          </span>
          {trees.length > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">{trees.length}</span>
          )}
          {totalRunning > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10.5px] text-foreground">
              <SessionRunningPixelGrid />
              <span>{t('common:worktrees.runningCount', { count: totalRunning })}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {cleanIdleTrees.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmCleanAll((v) => !v)}
              title={t('common:worktrees.cleanIdleHint', { count: cleanIdleTrees.length })}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" />
              <span>{t('common:worktrees.cleanIdleBtn', { count: cleanIdleTrees.length })}</span>
            </button>
          )}
          {!notRepo && currentWorkspace && (
            <button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors',
                createOpen
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-[var(--bg-hover)]',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('common:worktrees.newBtn')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadWorktrees({ showSpinner: true })}
            title={t('common:refresh')}
            aria-label={t('common:refresh')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', manualLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Batch clean-idle inline confirmation */}
      <AnimatedHeight>
        {confirmCleanAll && cleanIdleTrees.length > 0 ? (
          <div className="flex items-center justify-between gap-2 border-b border-border/55 bg-[var(--bg-1)]/55 px-3 py-2 text-[11.5px]">
            <span className="text-foreground-secondary">
              {t('common:worktrees.cleanIdleConfirm', { count: cleanIdleTrees.length })}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmCleanAll(false)}
                className="rounded px-2 py-0.5 text-muted-foreground hover:bg-[var(--bg-hover)]"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                disabled={cleaningAll}
                onClick={() => void handleCleanAllIdle()}
                className="rounded bg-foreground px-2.5 py-0.5 font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {cleaningAll ? t('common:loading') : t('common:confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </AnimatedHeight>

      {/* Clean single-column create form (never cramped in 360px sidebars) */}
      <AnimatedHeight>
        {createOpen && !notRepo ? (
          <div className="border-b border-border/55 bg-[var(--bg-1)]/45 px-3 py-3">
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('composer:worktree.branchLabel')}
                </span>
                <input
                  type="text"
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder={t('composer:worktree.branchPlaceholder')}
                  className="h-7 w-full rounded-md border border-border/80 bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('composer:worktree.baseBranchLabel')}
                </span>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="h-7 w-full rounded-md border border-border/80 bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                >
                  <option value="">{t('composer:worktree.currentHead')}</option>
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-foreground-secondary">
                <input
                  type="checkbox"
                  checked={fromOrigin}
                  onChange={(e) => setFromOrigin(e.target.checked)}
                  className="accent-[var(--brand)]"
                />
                <span>{t('composer:worktree.fromOriginLabel')}</span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('common:worktrees.promptLabel')}
                </span>
                <textarea
                  rows={2}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void handleLaunch()
                    }
                  }}
                  placeholder={t('common:worktrees.promptPlaceholder')}
                  className="studio-thin-scroll resize-none rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[12px] leading-snug text-foreground outline-none focus:border-[var(--brand)]"
                />
              </label>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[10.5px] text-muted-foreground">
                  {t('common:worktrees.shortcutHint')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="h-7 rounded-md px-2.5 text-[11.5px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    {t('common:cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleLaunch()}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {submitting
                        ? t('common:loading')
                        : taskPrompt.trim()
                          ? t('common:worktrees.launchBackgroundBtn')
                          : t('common:worktrees.createAndOpenBtn')}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </AnimatedHeight>

      {jobs.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-border/50 px-3 py-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between gap-2 rounded-md bg-[var(--bg-1)] px-2.5 py-1.5 text-[11.5px]"
            >
              <div className="flex min-w-0 items-center gap-2">
                {job.stage !== 'failed' && <SessionRunningPixelGrid />}
                <span className="truncate font-mono text-foreground">{job.branch}</span>
              </div>
              <span
                className={cn(
                  'shrink-0 text-[11px]',
                  job.stage === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {job.stage === 'creating'
                  ? t('common:worktrees.stageCreating')
                  : job.stage === 'starting'
                    ? t('common:worktrees.stageStarting')
                    : job.stage === 'running'
                      ? t('common:worktrees.stageRunning')
                      : job.error || t('common:operationFailed')}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="studio-thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {notRepo ? (
          <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
            {t('common:worktrees.notRepo')}
          </div>
        ) : !initialLoaded ? (
          <div className="flex flex-col gap-2 px-1 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--bg-hover)]/65" />
            ))}
          </div>
        ) : trees.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
            {t('common:worktrees.empty')}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {trees.map((tree) => {
              const isCurrent = workspacePathsEqual(currentWorkspace, tree.path)
              const folderName = tree.path.split(/[\\/]/).pop() || tree.path
              const branchLabel = tree.branch || folderName
              const confirming = confirmRemovePath === tree.path
              const matchedPr = tree.branch ? prByBranch[tree.branch] : undefined
              const runningSessions = tree.runningSessions ?? []

              return (
                <div
                  key={tree.path}
                  className={cn(
                    'group rounded-lg border px-2.5 py-2 transition-colors',
                    isCurrent
                      ? 'border-border/85 bg-[var(--bg-active)]/55'
                      : 'border-transparent hover:bg-[var(--bg-hover)]/65',
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => void activateWorkspace(tree.path)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {tree.runningCount > 0 ? (
                        <SessionRunningPixelGrid title={t('common:app.status.running')} />
                      ) : (
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            isCurrent ? 'bg-[var(--brand)]' : 'bg-muted-foreground/35',
                          )}
                        />
                      )}
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-[12.5px] font-medium text-foreground">
                        {branchLabel}
                      </span>
                      {tree.isMain && (
                        <span className="shrink-0 rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('common:sidebar.mainWorktree')}
                        </span>
                      )}
                      {tree.isCleanIdle && !isCurrent && (
                        <span className="shrink-0 rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('common:worktrees.idleClean')}
                        </span>
                      )}
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title={t('common:worktrees.newChatHere')}
                        aria-label={t('common:worktrees.newChatHere')}
                        onClick={() => void activateWorkspace(tree.path, { preferHome: true })}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title={t('common:worktrees.openTerminal')}
                        aria-label={t('common:worktrees.openTerminal')}
                        onClick={() => void openTerminalTab(undefined, tree.path)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title={t('common:worktrees.openFolder')}
                        aria-label={t('common:worktrees.openFolder')}
                        onClick={() => void ipcClient.invoke('shell.showItemInFolder', { path: tree.path }).catch(() => {})}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title={t('common:worktrees.copyPath')}
                        aria-label={t('common:worktrees.copyPath')}
                        onClick={() => {
                          void navigator.clipboard.writeText(tree.path)
                          toast.success(t('common:worktrees.copiedPath'))
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      {!isCurrent && (
                        <button
                          type="button"
                          title={t('common:worktrees.enter')}
                          aria-label={t('common:worktrees.enter')}
                          onClick={() => void activateWorkspace(tree.path)}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!tree.isMain && (
                        <button
                          type="button"
                          title={t('common:worktrees.remove')}
                          aria-label={t('common:worktrees.remove')}
                          onClick={() => setConfirmRemovePath(confirming ? null : tree.path)}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Meta line: folder, dirty, ahead/behind, and cross-linked PR chip */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-4 text-[11px] text-muted-foreground">
                    <span className="truncate font-mono opacity-80" title={tree.path}>
                      <FolderGit2 className="mr-1 inline h-3 w-3 align-[-2px] opacity-60" />
                      {folderName}
                    </span>
                    {tree.dirtyCount > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        {t('common:branches.dirty', { count: tree.dirtyCount })}
                      </span>
                    )}
                    {(tree.ahead > 0 || tree.behind > 0) && (
                      <span className="font-mono">
                        {tree.ahead > 0 ? `↑${tree.ahead}` : ''}
                        {tree.ahead > 0 && tree.behind > 0 ? ' ' : ''}
                        {tree.behind > 0 ? `↓${tree.behind}` : ''}
                      </span>
                    )}
                    {matchedPr && (
                      <button
                        type="button"
                        onClick={() => openGitHubPr(matchedPr.number)}
                        title={`PR #${matchedPr.number}: ${matchedPr.title}`}
                        className="inline-flex items-center gap-1 rounded px-1 py-0.2 font-mono text-[10.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <GitFork
                          className={cn(
                            'h-3 w-3',
                            matchedPr.state === 'merged'
                              ? 'text-violet-500'
                              : 'text-emerald-600 dark:text-emerald-400',
                          )}
                        />
                        <span>#{matchedPr.number}</span>
                        {matchedPr.checksState === 'failing' ? (
                          <XCircle className="h-3 w-3 text-destructive" />
                        ) : matchedPr.checksState === 'passing' ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        ) : matchedPr.checksState === 'pending' ? (
                          <Clock className="h-3 w-3 text-sky-500" />
                        ) : null}
                      </button>
                    )}
                  </div>

                  {/* Direct jump links to live running sessions inside this worktree */}
                  {runningSessions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
                      {runningSessions.map((rs, idx) => (
                        <button
                          key={rs.sessionFile || idx}
                          type="button"
                          onClick={() =>
                            void activateWorkspace(tree.path, {
                              sessionId: rs.sessionId || undefined,
                              sessionFile: rs.sessionFile,
                            })
                          }
                          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--brand)]/[0.08] px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-[var(--brand)]/15"
                        >
                          <SessionRunningPixelGrid className="scale-75" />
                          <span className="truncate">
                            {t('common:worktrees.jumpRunningSession', { index: idx + 1 })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {confirming && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/[0.04] px-2.5 py-1.5 text-[11.5px]">
                      <span className="text-foreground-secondary">
                        {t('common:worktrees.removeConfirm')}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={removingPath === tree.path}
                          onClick={() => setConfirmRemovePath(null)}
                          className="rounded px-2 py-0.5 text-muted-foreground hover:bg-[var(--bg-hover)]"
                        >
                          {t('common:cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={removingPath === tree.path}
                          onClick={() => void handleRemove(tree)}
                          className="rounded bg-destructive/90 px-2 py-0.5 font-medium text-white hover:bg-destructive disabled:opacity-50"
                        >
                          {removingPath === tree.path ? t('common:loading') : t('common:delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
