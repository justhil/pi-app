import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackgroundTaskSnapshot } from '@shared/background-tasks'
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { openBackgroundTaskInTerminal } from '@renderer/features/terminal/background-task-terminal'
import {
  refreshBackgroundTasksFromMain,
  upsertSingleBackgroundTask,
} from '@renderer/stores/background-tasks-store'

interface BackgroundTasksPopoverContentProps {
  activeSessionFile: string | null | undefined
  workspaceId?: string | null
  currentSessionTasks: BackgroundTaskSnapshot[]
  otherRunningTasks: BackgroundTaskSnapshot[]
  loading: boolean
  sessionTitleForFile: (file: string) => string | undefined
  onOpenSession?: (file: string) => void
  onClose?: () => void
}

function formatDurationShort(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function formatTimeoutCap(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`
}

function StatusBadge({ task }: { task: BackgroundTaskSnapshot }) {
  const { t } = useTranslation()
  if (task.status === 'running') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
        {t('common:bgTasks.status.running')}
      </span>
    )
  }
  if (task.status === 'exited' && (task.exitCode === 0 || task.exitCode === null)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-secondary">
        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        {task.exitCode === 0 ? t('common:bgTasks.status.exitedOk') : t('common:bgTasks.status.exited')}
      </span>
    )
  }
  if (task.status === 'killed') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
        <Square className="h-2.5 w-2.5" />
        {t('common:bgTasks.status.killed')}
      </span>
    )
  }
  if (task.status === 'timed_out') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" />
        {t('common:bgTasks.status.timedOut')}
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10.5px] font-medium text-destructive">
      {task.status === 'failed' ? <AlertCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {task.exitCode !== null
        ? t('common:bgTasks.status.exitCode', { code: task.exitCode })
        : t('common:bgTasks.status.failed')}
    </span>
  )
}

export function BackgroundTasksPopoverContent({
  activeSessionFile,
  workspaceId,
  currentSessionTasks,
  otherRunningTasks,
  loading,
  sessionTitleForFile,
  onOpenSession,
  onClose,
}: BackgroundTasksPopoverContentProps) {
  const { t } = useTranslation()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tailById, setTailById] = useState<Record<string, { tail: string; truncated: boolean; loading?: boolean }>>({})
  const [killingId, setKillingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const allTasks = [...currentSessionTasks, ...otherRunningTasks]
  const runningCount = allTasks.filter((item) => item.status === 'running').length

  const inspectTask = useCallback(async (task: BackgroundTaskSnapshot, silent = false) => {
    if (!silent) {
      setTailById((prev) => ({
        ...prev,
        [task.id]: {
          tail: prev[task.id]?.tail ?? task.tail,
          truncated: prev[task.id]?.truncated ?? false,
          loading: true,
        },
      }))
    }
    try {
      const res = (await ipcClient.invoke('backgroundTasks.inspect', {
        sessionFile: task.sessionFile,
        ...(workspaceId ? { workspaceId } : {}),
        taskId: task.id,
        outputPath: task.outputPath,
      })) as
        | { ok?: boolean; task?: BackgroundTaskSnapshot | null; tail?: string; truncated?: boolean }
        | undefined
      if (res?.task) upsertSingleBackgroundTask(res.task)
      setTailById((prev) => ({
        ...prev,
        [task.id]: {
          tail: typeof res?.tail === 'string' && res.tail.length > 0 ? res.tail : (res?.task?.tail ?? task.tail),
          truncated: res?.truncated === true,
          loading: false,
        },
      }))
    } catch {
      setTailById((prev) => ({
        ...prev,
        [task.id]: {
          tail: prev[task.id]?.tail ?? task.tail,
          truncated: prev[task.id]?.truncated ?? false,
          loading: false,
        },
      }))
    }
  }, [])

  // Hydrate when popover opens
  useEffect(() => {
    void refreshBackgroundTasksFromMain(activeSessionFile, workspaceId)
  }, [activeSessionFile, workspaceId])

  // Poll live status & expanded output ONLY while popover is open and >= 1 task is running
  useEffect(() => {
    if (runningCount === 0) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
      void refreshBackgroundTasksFromMain(activeSessionFile, workspaceId)
      if (expandedId) {
        const match = allTasks.find((t) => t.id === expandedId)
        if (match && match.status === 'running') {
          void inspectTask(match, true)
        }
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [runningCount, activeSessionFile, workspaceId, expandedId, inspectTask])

  const handleToggleExpand = (task: BackgroundTaskSnapshot) => {
    if (expandedId === task.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(task.id)
    void inspectTask(task)
  }

  const handleKill = async (task: BackgroundTaskSnapshot) => {
    if (!task.sessionFile) return
    setKillingId(task.id)
    setActionError(null)
    try {
      const res = (await ipcClient.invoke('backgroundTasks.kill', {
        sessionFile: task.sessionFile,
        taskId: task.id,
      })) as { ok?: boolean; task?: BackgroundTaskSnapshot | null; error?: string } | undefined
      if (res?.task) upsertSingleBackgroundTask(res.task)
      if (res && res.ok === false) {
        setActionError(res.error || t('common:operationFailed'))
      } else {
        await refreshBackgroundTasksFromMain(activeSessionFile, workspaceId)
      }
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setKillingId(null)
    }
  }

  const handleCopyCommand = (task: BackgroundTaskSnapshot) => {
    void navigator.clipboard.writeText(task.command).then(() => {
      setCopiedId(task.id)
      window.setTimeout(() => setCopiedId((cur) => (cur === task.id ? null : cur)), 1500)
    })
  }

  const handleOpenInTerminal = (task: BackgroundTaskSnapshot) => {
    openBackgroundTaskInTerminal(task)
    onClose?.()
  }

  const handleOpenLog = (outputPath: string) => {
    void ipcClient.invoke('shell.openPath', { path: outputPath }).catch(() => {})
  }

  const renderTaskCard = (task: BackgroundTaskSnapshot, showSessionBadge: boolean) => {
    const expanded = expandedId === task.id
    const inspectState = tailById[task.id]
    const outputText = (inspectState?.tail ?? task.tail).trimEnd()
    const elapsedMs =
      task.status === 'running'
        ? Math.max(0, nowMs - task.createdAt)
        : Math.max(0, task.updatedAt - task.createdAt)
    const cap = formatTimeoutCap(task.timeoutSeconds)
    const sessionLabel =
      showSessionBadge && task.sessionFile ? sessionTitleForFile(task.sessionFile) : undefined

    return (
      <div
        key={`${task.sessionFile ?? 'local'}::${task.id}`}
        data-testid={`bg-task-row-${task.id}`}
        className="rounded-md border border-border/55 bg-[var(--bg-2)]/30 transition-colors"
      >
        <div className="flex items-start gap-1.5 px-2.5 py-2">
          <button
            type="button"
            onClick={() => handleToggleExpand(task)}
            className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <StatusBadge task={task} />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-foreground"
                  title={task.command}
                >
                  {task.command}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
                <span className="font-mono opacity-80">{task.id}</span>
                {(task.status === 'running' || elapsedMs > 0) && (
                  <span className="tabular-nums">
                    {formatDurationShort(elapsedMs)}
                    {cap ? ` / ${cap}` : ''}
                  </span>
                )}
                {task.lineCount > 0 && (
                  <span className="tabular-nums">
                    {t('common:bgTasks.lines', { count: task.lineCount })}
                  </span>
                )}
                {sessionLabel && task.sessionFile && onOpenSession ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSession(task.sessionFile!)
                    }}
                    className="truncate text-primary/85 hover:underline"
                  >
                    {sessionLabel}
                  </button>
                ) : null}
              </div>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            <button
              type="button"
              onClick={() => handleCopyCommand(task)}
              title={t('common:bgTasks.copyCommand')}
              aria-label={t('common:bgTasks.copyCommand')}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              {copiedId === task.id ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleOpenInTerminal(task)}
              title={t('common:bgTasks.openInTerminal')}
              aria-label={t('common:bgTasks.openInTerminal')}
              data-testid={`bg-task-open-terminal-${task.id}`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5" />
            </button>
            {task.status === 'running' && task.sessionFile && (
              <button
                type="button"
                disabled={killingId === task.id}
                onClick={() => void handleKill(task)}
                title={t('common:bgTasks.kill')}
                aria-label={t('common:bgTasks.kill')}
                data-testid={`bg-task-kill-${task.id}`}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/12 disabled:opacity-50"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>{t('common:bgTasks.stopShort')}</span>
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/45 px-2.5 py-2">
            {task.error && (
              <div className="mb-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {task.error}
              </div>
            )}
            <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <span>
                {inspectState?.truncated
                  ? t('common:bgTasks.recentOutputTruncated')
                  : t('common:bgTasks.recentOutput')}
              </span>
              <div className="flex items-center gap-1.5">
                {task.outputPath && (
                  <button
                    type="button"
                    onClick={() => handleOpenLog(task.outputPath!)}
                    title={t('common:bgTasks.openLog')}
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    <span>{t('common:bgTasks.logFileShort')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void inspectTask(task)}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  <RefreshCw className={cn('h-2.5 w-2.5', inspectState?.loading && 'animate-spin')} />
                  <span>{t('common:refresh')}</span>
                </button>
              </div>
            </div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-2 font-mono text-[11px] leading-[1.45] text-foreground/90">
              {outputText || (inspectState?.loading ? t('common:loading') : t('common:bgTasks.noOutput'))}
            </pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">
          {t('common:bgTasks.summary', {
            running: runningCount,
            finished: Math.max(0, allTasks.length - runningCount),
          })}
        </span>
        <button
          type="button"
          className="workbench-icon"
          aria-label={t('common:refresh')}
          title={t('common:refresh')}
          onClick={() => void refreshBackgroundTasksFromMain(activeSessionFile, workspaceId)}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {actionError && (
        <p role="alert" className="workbench-error mb-2">
          {actionError}
        </p>
      )}

      {allTasks.length === 0 ? (
        <div className="workbench-empty py-5">
          <Activity className="h-4 w-4 opacity-50" />
          <p>{t('common:bgTasks.empty')}</p>
          <span>{t('common:bgTasks.emptyHint')}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {currentSessionTasks.length > 0 && (
            <section className="space-y-1.5" aria-label={t('common:bgTasks.currentSession')}>
              {otherRunningTasks.length > 0 && (
                <h3 className="text-[11px] font-medium text-muted-foreground">
                  {t('common:bgTasks.currentSession')}
                </h3>
              )}
              {currentSessionTasks.map((task) => renderTaskCard(task, false))}
            </section>
          )}
          {otherRunningTasks.length > 0 && (
            <section className="space-y-1.5" aria-label={t('common:bgTasks.otherSessions')}>
              <h3 className="text-[11px] font-medium text-muted-foreground">
                {t('common:bgTasks.otherSessions')}
              </h3>
              {otherRunningTasks.map((task) => renderTaskCard(task, true))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
