import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FolderGit2,
  GitFork,
  Plus,
  XCircle,
} from '@renderer/components/icons'
import type { GitWorktree } from '@shared/git-worktree'
import type { GitHubPullRequestSummary } from '@shared/github-status'
import type { ComposerContextPosition } from '@shared/ui-customization'
import { workspacePathsEqual } from '@shared/workspace-path'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { useUIStore } from '@renderer/stores/ui-store'
import { useDraftWorktreeStore } from '@renderer/stores/draft-worktree-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { BranchStatusTrigger } from '@renderer/features/git/branch-status'
import { cn } from '@renderer/lib/utils'

interface BranchRef {
  name: string
  remote: boolean
  current: boolean
}

export function ComposerContextStrip({
  placement = 'below',
}: {
  placement?: Exclude<ComposerContextPosition, 'hidden'>
}) {
  const { t } = useTranslation()
  const uiCustom = useUIStore((s) => s.uiCustomization)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const timelineCount = useUIStore((s) => s.timelineItems.length)

  const mode = useDraftWorktreeStore((s) => s.mode)
  const branchName = useDraftWorktreeStore((s) => s.branchName)
  const baseBranch = useDraftWorktreeStore((s) => s.baseBranch)
  const fromOrigin = useDraftWorktreeStore((s) => s.fromOrigin)
  const existingWorktreePath = useDraftWorktreeStore((s) => s.existingWorktreePath)
  const setMode = useDraftWorktreeStore((s) => s.setMode)
  const setBranchName = useDraftWorktreeStore((s) => s.setBranchName)
  const setBaseBranch = useDraftWorktreeStore((s) => s.setBaseBranch)
  const setFromOrigin = useDraftWorktreeStore((s) => s.setFromOrigin)
  const setExistingWorktreePath = useDraftWorktreeStore((s) => s.setExistingWorktreePath)
  const reset = useDraftWorktreeStore((s) => s.reset)

  const openGitHubPr = usePanelIntentStore((s) => s.openGitHubPr)
  const openWorktreesPanel = usePanelIntentStore((s) => s.openWorktreesPanel)

  const [open, setOpen] = useState(false)
  const [isRepo, setIsRepo] = useState(false)
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [branches, setBranches] = useState<BranchRef[]>([])
  const [branchPr, setBranchPr] = useState<GitHubPullRequestSummary | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const activeForPlacement = uiCustom.composerContextPosition === placement
  const showWorktree = uiCustom.composerWorktreeMode !== 'hidden'
  const showBranch = uiCustom.composerBranchMode !== 'hidden'
  const visibleHere = activeForPlacement && (showWorktree || showBranch)

  const isBlankDraft =
    Boolean(currentWorkspace) &&
    !ephemeralSandboxDraft &&
    !historySessionFile &&
    !currentSessionId &&
    timelineCount === 0

  const loadGitContext = useCallback(async () => {
    if (!visibleHere || !currentWorkspace || ephemeralSandboxDraft) {
      setIsRepo(false)
      setCurrentBranch(null)
      setBranchPr(null)
      return
    }
    try {
      const [status, wtRes] = await Promise.all([
        ipcClient.invoke('git.branchStatus', { cwd: currentWorkspace }) as Promise<{
          isRepo?: boolean
          branch?: string | null
        }>,
        ipcClient
          .invoke('desktop.gitWorktrees', { workspaceId: currentWorkspace })
          .catch(() => null) as Promise<{ ok?: boolean; trees?: GitWorktree[] } | null>,
      ])
      const repoOk = Boolean(status?.isRepo)
      const br = status?.branch ?? null
      setIsRepo(repoOk)
      setCurrentBranch(br)
      setWorktrees(wtRes?.trees ?? [])

      if (repoOk && br && uiCustom.composerBranchMode === 'full') {
        const prRes = (await ipcClient
          .invoke('github.branchPr', { cwd: currentWorkspace, branch: br })
          .catch(() => null)) as { ok?: boolean; pr?: GitHubPullRequestSummary | null } | null
        setBranchPr(prRes?.ok ? (prRes.pr ?? null) : null)
      } else {
        setBranchPr(null)
      }
    } catch {
      setIsRepo(false)
      setBranchPr(null)
    }
  }, [visibleHere, currentWorkspace, ephemeralSandboxDraft, uiCustom.composerBranchMode])

  useEffect(() => {
    if (isBlankDraft) reset()
    setOpen(false)
    void loadGitContext()
    if (!visibleHere || !currentWorkspace || ephemeralSandboxDraft) return
    const off = onGitWorkspaceChanged((p) => {
      if (workspacePathsEqual(p.cwd, currentWorkspace)) void loadGitContext()
    })
    const onFocus = () => void loadGitContext()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [visibleHere, currentWorkspace, ephemeralSandboxDraft, isBlankDraft, loadGitContext, reset])

  useEffect(() => {
    if (!open || !currentWorkspace || !isBlankDraft) return
    void (
      ipcClient.invoke('git.branches', { cwd: currentWorkspace }) as Promise<{
        branches?: BranchRef[]
      }>
    )
      .then((res) => setBranches((res?.branches ?? []).filter((b) => !b.remote)))
      .catch(() => {})
  }, [open, currentWorkspace, isBlankDraft])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!visibleHere || !currentWorkspace || ephemeralSandboxDraft || !isRepo) return null

  const currentTree = worktrees.find((w) => workspacePathsEqual(w.path, currentWorkspace))
  const siblingWorktrees = worktrees.filter((w) => !workspacePathsEqual(w.path, currentWorkspace))
  const selectedExisting = siblingWorktrees.find((w) =>
    workspacePathsEqual(w.path, existingWorktreePath),
  )
  const isSecondaryWorktree = Boolean(currentTree && !currentTree.isMain)
  const parallelCount = Math.max(0, worktrees.length - 1)

  const worktreeMode = uiCustom.composerWorktreeMode
  const branchMode = uiCustom.composerBranchMode
  const contextStyle = uiCustom.composerContextStyle
  const isStatusBar = placement === 'statusbar'
  const isPill = !isStatusBar && contextStyle === 'pill'
  const isTray = !isStatusBar && contextStyle === 'tray'

  const fullEnvLabel = isBlankDraft
    ? mode === 'new-worktree'
      ? branchName.trim()
        ? `Worktree · ${branchName.trim()}`
        : t('composer:worktree.newMode')
      : mode === 'existing-worktree' && selectedExisting
        ? `Worktree · ${selectedExisting.branch || selectedExisting.path.split(/[\\/]/).pop()}`
        : t('composer:worktree.localMode')
    : isSecondaryWorktree
      ? `Worktree · ${currentTree?.branch || currentWorkspace.split(/[\\/]/).pop()}`
      : parallelCount > 0
        ? `${t('composer:worktree.localMode')} · ${parallelCount} worktree`
        : t('composer:worktree.localMode')

  const compactEnvLabel = isBlankDraft
    ? mode === 'new-worktree'
      ? branchName.trim() || 'Worktree'
      : mode === 'existing-worktree' && selectedExisting
        ? selectedExisting.branch || selectedExisting.path.split(/[\\/]/).pop() || 'Worktree'
        : t('composer:worktree.localMode')
    : isSecondaryWorktree
      ? currentTree?.branch || currentWorkspace.split(/[\\/]/).pop() || 'Worktree'
      : t('composer:worktree.localMode')

  const envLabel = worktreeMode === 'compact' ? compactEnvLabel : fullEnvLabel
  const popAlignRight = uiCustom.composerContextSwapped && !isStatusBar

  const worktreeNode = showWorktree ? (
    <div ref={popRef} className="relative flex min-w-0 items-center">
      <button
        type="button"
        data-pi-slot="composer-worktree-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={fullEnvLabel}
        aria-label={fullEnvLabel}
        onClick={() => setOpen((v) => !v)}
        className={
          isStatusBar
            ? 'workbench-status-trigger'
            : cn(
                'inline-flex h-6 max-w-[260px] items-center gap-1.5 text-[11.5px] transition-colors',
                isPill
                  ? 'rounded-full border border-border/75 bg-background/85 px-2.5 hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground'
                  : 'rounded-md border border-transparent px-1.5 hover:bg-[var(--bg-hover)] hover:text-foreground',
                (isBlankDraft && mode !== 'local') || isSecondaryWorktree
                  ? 'font-medium text-foreground'
                  : 'text-foreground-secondary',
              )
        }
      >
        <FolderGit2
          className={cn(
            isStatusBar ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0',
            (isBlankDraft && mode !== 'local') || isSecondaryWorktree
              ? 'text-[var(--brand)]'
              : 'opacity-70',
          )}
        />
        {worktreeMode !== 'icon' && <span className="truncate">{envLabel}</span>}
        {worktreeMode !== 'icon' && !isStatusBar && (
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 opacity-55 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('composer:worktree.title')}
          className={cn(
            'overlay-panel absolute bottom-full z-50 mb-1.5 w-[312px] rounded-xl border border-border bg-background p-3 shadow-xl',
            popAlignRight ? 'right-0' : 'left-0',
          )}
        >
          {isBlankDraft ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-foreground">
                  {t('composer:worktree.title')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    openWorktreesPanel()
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  {t('common:worktrees.manageAll')}
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('local')
                    setExistingWorktreePath(null)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors',
                    mode === 'local'
                      ? 'border-[var(--brand)]/55 bg-[var(--brand)]/[0.07] text-foreground'
                      : 'border-transparent text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                  )}
                >
                  <div>
                    <div className="font-medium text-foreground">{t('composer:worktree.localMode')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {currentBranch
                        ? `${t('composer:worktree.localDesc')} (${currentBranch})`
                        : t('composer:worktree.localDesc')}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('new-worktree')
                    setExistingWorktreePath(null)
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors',
                    mode === 'new-worktree'
                      ? 'border-[var(--brand)]/55 bg-[var(--brand)]/[0.07] text-foreground'
                      : 'border-transparent text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                  )}
                >
                  <div>
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      <Plus className="h-3 w-3 text-[var(--brand)]" />
                      <span>{t('composer:worktree.newMode')}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('composer:worktree.newDesc')}
                    </div>
                  </div>
                </button>
              </div>

              {mode === 'new-worktree' && (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/60 bg-[var(--bg-1)]/45 p-2.5 text-[11.5px]">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">{t('composer:worktree.branchLabel')}</span>
                    <input
                      type="text"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder={t('composer:worktree.branchPlaceholder')}
                      className="h-7 rounded-md border border-border bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                    />
                  </label>

                  {branches.length > 0 && (
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">
                        {t('composer:worktree.baseBranchLabel')}
                      </span>
                      <select
                        value={baseBranch ?? ''}
                        onChange={(e) => setBaseBranch(e.target.value || null)}
                        className="h-7 rounded-md border border-border bg-background px-2 font-mono text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
                      >
                        <option value="">
                          {currentBranch
                            ? `${t('composer:worktree.currentHead')} (${currentBranch})`
                            : t('composer:worktree.currentHead')}
                        </option>
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-[11.5px] text-foreground-secondary">
                    <input
                      type="checkbox"
                      checked={fromOrigin}
                      onChange={(e) => setFromOrigin(e.target.checked)}
                      className="accent-[var(--brand)]"
                    />
                    <span>{t('composer:worktree.fromOriginLabel')}</span>
                  </label>
                </div>
              )}

              {siblingWorktrees.length > 0 && (
                <div className="mt-2.5 border-t border-border/55 pt-2">
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('composer:worktree.existingHeading')}
                  </div>
                  <div className="studio-thin-scroll flex max-h-[120px] flex-col gap-0.5 overflow-y-auto">
                    {siblingWorktrees.map((wt) => {
                      const active =
                        mode === 'existing-worktree' &&
                        workspacePathsEqual(wt.path, existingWorktreePath)
                      const name = wt.branch || wt.path.split(/[\\/]/).pop() || wt.path
                      return (
                        <button
                          key={wt.path}
                          type="button"
                          onClick={() => {
                            setMode('existing-worktree')
                            setExistingWorktreePath(wt.path)
                            setOpen(false)
                          }}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[11.5px] transition-colors',
                            active
                              ? 'border-[var(--brand)]/55 bg-[var(--brand)]/[0.08] text-foreground'
                              : 'border-transparent text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                          )}
                        >
                          <span className="truncate font-mono">{name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {wt.isMain ? t('common:sidebar.mainWorktree') : 'worktree'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
                {t('common:worktrees.quickTitle')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  openWorktreesPanel({ expandCreate: true })
                }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)]"
              >
                <Plus className="h-3.5 w-3.5 text-[var(--brand)]" />
                <span>{t('common:worktrees.newParallel')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  openWorktreesPanel()
                }}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <FolderGit2 className="h-3.5 w-3.5 opacity-75" />
                  <span>{t('common:worktrees.manageAll')}</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{worktrees.length}</span>
              </button>
              {siblingWorktrees.length > 0 && (
                <div className="mt-1 border-t border-border/55 pt-1.5">
                  <div className="mb-1 px-1 text-[10.5px] text-muted-foreground">
                    {t('common:worktrees.switchTo')}
                  </div>
                  <div className="studio-thin-scroll flex max-h-[132px] flex-col gap-0.5 overflow-y-auto">
                    {siblingWorktrees.map((wt) => {
                      const name = wt.branch || wt.path.split(/[\\/]/).pop() || wt.path
                      return (
                        <button
                          key={wt.path}
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            void activateWorkspace(wt.path)
                          }}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                        >
                          <span className="truncate font-mono">{name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {wt.isMain ? t('common:sidebar.mainWorktree') : 'worktree'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null

  const branchNode = showBranch ? (
    <div className="flex shrink-0 items-center gap-1">
      {branchPr && branchMode === 'full' && (
        <button
          type="button"
          onClick={() => openGitHubPr(branchPr.number)}
          title={`PR #${branchPr.number}: ${branchPr.title}`}
          className={
            isStatusBar
              ? 'workbench-status-trigger tabular-nums'
              : cn(
                  'inline-flex h-6 items-center gap-1.5 text-[11.5px] text-foreground-secondary transition-colors',
                  isPill
                    ? 'rounded-full border border-border/75 bg-background/85 px-2.5 hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground'
                    : 'rounded-md border border-transparent px-1.5 hover:bg-[var(--bg-hover)] hover:text-foreground',
                )
          }
        >
          <GitFork
            className={cn(
              'h-3 w-3 shrink-0',
              branchPr.state === 'merged'
                ? 'text-violet-500'
                : branchPr.isDraft
                  ? 'text-muted-foreground'
                  : 'text-emerald-600 dark:text-emerald-400',
            )}
          />
          <span className="font-mono">#{branchPr.number}</span>
          {branchPr.mergeable === 'CONFLICTING' ? (
            <AlertTriangle className="h-3 w-3 text-amber-500" />
          ) : branchPr.checksState === 'failing' ? (
            <XCircle className="h-3 w-3 text-destructive" />
          ) : branchPr.checksState === 'passing' ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          ) : branchPr.checksState === 'pending' ? (
            <Clock className="h-3 w-3 text-sky-500" />
          ) : null}
        </button>
      )}
      <BranchStatusTrigger
        variant={isStatusBar ? 'statusbar' : 'inline'}
        compact={branchMode === 'compact'}
        pillStyle={isPill}
      />
    </div>
  ) : null

  if (isStatusBar) {
    return (
      <div
        data-pi-slot="composer-context-strip"
        className="flex shrink-0 items-center"
      >
        {uiCustom.composerContextSwapped ? (
          <>
            {branchNode}
            {worktreeNode}
          </>
        ) : (
          <>
            {worktreeNode}
            {branchNode}
          </>
        )}
      </div>
    )
  }

  return (
    <div
      data-pi-slot="composer-context-strip"
      className={cn(
        'pointer-events-auto flex min-h-7 w-full items-center justify-between gap-2 text-[11.5px] text-foreground-secondary',
        placement === 'above' ? 'mb-1.5' : 'mt-1',
        isTray
          ? 'rounded-lg border border-border/60 bg-[var(--bg-1)]/75 px-2.5 py-1'
          : 'px-1.5 py-0.5',
      )}
    >
      {uiCustom.composerContextSwapped ? (
        <>
          {branchNode ?? <span />}
          {worktreeNode}
        </>
      ) : (
        <>
          {worktreeNode ?? <span />}
          {branchNode}
        </>
      )}
    </div>
  )
}
