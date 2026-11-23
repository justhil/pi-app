import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from '@renderer/components/icons'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathsEqual } from '@shared/workspace-path'
import { BranchPickerPopover } from './branch-picker-popover'

type BranchStatus = {
  isRepo: boolean
  branch: string | null
  head: string
  upstream: string | null
  ahead: number
  behind: number
  dirty: number
}

/** Opens the branch picker from elsewhere (command palette). */
export const OPEN_BRANCH_PICKER = 'pi-desktop:open-branch-picker'

/**
 * Current project branch trigger (used in Composer context strip & status bar).
 * Delegates branch list, switching, Worktree jump & conflict protection to shared BranchPickerPopover.
 */
export function BranchStatusTrigger({
  variant = 'statusbar',
  compact = false,
  pillStyle = false,
}: {
  variant?: 'statusbar' | 'inline'
  compact?: boolean
  pillStyle?: boolean
} = {}) {
  const { t } = useTranslation()
  const cwd = useUIStore((s) => s.currentWorkspace)
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const closePicker = useCallback(() => setOpen(false), [])

  const refresh = useCallback(async () => {
    if (!cwd) return setStatus(null)
    try {
      setStatus((await ipcClient.invoke('git.branchStatus', { cwd })) as BranchStatus)
    } catch {
      setStatus(null)
    }
  }, [cwd])

  useEffect(() => {
    setStatus(null)
    void refresh()
    const off = onGitWorkspaceChanged((p) => workspacePathsEqual(p.cwd, cwd) && void refresh())
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [cwd, refresh])

  useEffect(() => {
    const onOpen = () => status?.isRepo && setOpen(true)
    window.addEventListener(OPEN_BRANCH_PICKER, onOpen)
    return () => window.removeEventListener(OPEN_BRANCH_PICKER, onOpen)
  }, [status?.isRepo])

  if (!cwd || !status?.isRepo) return null
  const label = status.branch ?? (status.head ? status.head.slice(0, 7) : t('common:branches.detached'))

  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-pi-slot="composer-branch-btn"
        className={
          variant === 'inline'
            ? pillStyle
              ? 'inline-flex h-6 items-center gap-1 rounded-full border border-border/75 bg-background/85 px-2.5 text-[11.5px] text-foreground-secondary tabular-nums transition-colors hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-50'
              : 'inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-[11.5px] text-foreground-secondary tabular-nums transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-50'
            : 'workbench-status-trigger branch-status-trigger tabular-nums'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('common:branches.trigger', { branch: label })}
        title={[
          status.upstream ? `${label} → ${status.upstream}` : label,
          status.dirty ? t('common:branches.dirty', { count: status.dirty }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <GitBranch className={cn('h-3 w-3 shrink-0', busy && 'animate-pulse')} />
        <span className="max-w-[14rem] truncate">{label}</span>
        {!compact && status.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warn)]" aria-hidden /> : null}
        {!compact && status.ahead ? <span className="text-foreground-tertiary">↑{status.ahead}</span> : null}
        {!compact && status.behind ? <span className="text-foreground-tertiary">↓{status.behind}</span> : null}
      </button>

      <BranchPickerPopover
        cwd={cwd}
        open={open}
        anchorRef={anchor}
        onClose={closePicker}
        currentBranchHint={status.branch ?? status.head}
        onBusyChange={setBusy}
        onSwitched={() => void refresh()}
      />
    </>
  )
}
