import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowRight,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
} from '@renderer/components/icons'
import type { GitWorktree } from '@shared/git-worktree'
import { workspacePathsEqual } from '@shared/workspace-path'
import { AnimatedHeight } from '@renderer/components/ui/animated-height'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { useUIStore } from '@renderer/stores/ui-store'
import { slugifyWorktreeBranchFromPrompt } from '@renderer/stores/draft-worktree-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { SessionRunningPixelGrid } from '@renderer/features/workspace/session-running-pixel-grid'
import { cn } from '@renderer/lib/utils'

interface EnrichedWorktree extends GitWorktree {
  dirtyCount: number
  ahead: number
  behind: number
  runningCount: number
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

export function WorktreesPanel() {
  const { t } = useTranslation()
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const openCreateSignal = usePanelIntentStore((s) => s.openWorktreeCreateSignal)

  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [trees, setTrees] = useState<EnrichedWorktree[]>([])
  const [loading, setLoading] = useState(false)
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

  useEffect(() => {
    if (openCreateSignal > 0) setCreateOpen(true)
  }, [openCreateSignal])

  const loadWorktrees = useCallback(async () => {
    if (!currentWorkspace) {
      setTrees([])
      setRepoPath(null)
      setNotRepo(false)
      return
    }
    setLoading(true)
    try {
      const res = (await ipcClient.invoke('desktop.gitWorktreesDetail', {
        workspaceId: currentWorkspace,
      })) as {
        ok?: boolean
        repositoryPath?: string | null
        trees?: EnrichedWorktree[]
        error?: string
      }
      if (!res?.ok) {
        setNotRepo(true)
        setTrees([])
        setRepoPath(null)
      } else {
        setNotRepo(false)
        setRepoPath(res.repositoryPath ?? null)
        setTrees(res.trees ?? [])
      }
    } catch {
      setNotRepo(true)
      setTrees([])
    } finally {
      setLoading(false)
    }
  }, [currentWorkspace])

  useEffect(() => {
    void loadWorktrees()
    if (!currentWorkspace) return
    const off = onGitWorkspaceChanged(() => void loadWorktrees())
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) void loadWorktrees()
    }, 5000)
    return () => {
      off()
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
        })) as {
          ok?: boolean
          path?: string
          branch?: string
          sessionId?: string
          sessionFile?: string
          error?: string
        }
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
            onClick={() => void loadWorktrees()}
            title={t('common:refresh')}
            aria-label={t('common:refresh')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <AnimatedHeight>
        {createOpen && !notRepo ? (
          <div className="border-b border-border/55 bg-[var(--bg-1)]/45 px-3 py-3">
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {t('composer:worktree.branchLabel')}
                  </span>
                  <input
                    type="text"
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    placeholder={t('composer:worktree.branchPlaceholder')}
                    className="h-7 rounded-md border border-border/80 bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {t('composer:worktree.baseBranchLabel')}
                  </span>
                  <select
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="h-7 rounded-md border border-border/80 bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                  >
                    <option value="">{t('composer:worktree.currentHead')}</option>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

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
                  placeholder={t('common:worktrees.promptPlaceholder')}
                  className="studio-thin-scroll resize-none rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[12px] leading-snug text-foreground outline-none focus:border-[var(--brand)]"
                />
              </label>

              <div className="flex items-center justify-end gap-1.5 pt-0.5">
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
        ) : trees.length === 0 && !loading ? (
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
                  <div className="flex items-center justify-between gap-2">
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
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-75 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title={t('common:worktrees.newChatHere')}
                        aria-label={t('common:worktrees.newChatHere')}
                        onClick={() => void activateWorkspace(tree.path, { preferHome: true })}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
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

                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-4 text-[11px] text-muted-foreground">
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
                    {tree.runningCount > 0 && (
                      <span className="text-foreground">
                        {t('common:worktrees.runningCount', { count: tree.runningCount })}
                      </span>
                    )}
                  </div>

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
