import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, GitBranch, Plus } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ShellPopover } from '@renderer/features/shell/shell-popover'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathsEqual } from '@shared/workspace-path'

type BranchStatus = { isRepo: boolean; branch: string | null; head: string; upstream: string | null; ahead: number; behind: number; dirty: number }
type BranchRef = { name: string; remote: boolean; head: string; date: number; upstream: string | null; current: boolean; worktree: string | null }
type SwitchReq = { name: string; remote?: boolean; create?: boolean; stash?: boolean }
type SwitchRes =
  | { ok: true; branch: string; stashed: boolean; restorable?: { ref: string; message: string } | null }
  | { ok: false; reason: 'dirty-conflict'; files: string[] }
  | { ok: false; reason: 'invalid-name' | 'git'; message: string }

/** Opens the branch picker from elsewhere (command palette). */
export const OPEN_BRANCH_PICKER = 'pi-desktop:open-branch-picker'

/** Sessions of this project whose turn is still going (switching changes the files under them). */
function useRunningHere(cwd: string | null): number {
  const attention = useUIStore((s) => s.sessionAttention)
  const sessions = useUIStore((s) => s.sessions)
  return useMemo(() => {
    if (!cwd) return 0
    return Object.entries(attention).filter(([file, a]) => {
      if (a !== 'working' && a !== 'needs-you') return false
      const s = sessions.find((x) => x.sessionFile === file)
      return s ? workspacePathsEqual(s.workspaceId, cwd) : false
    }).length
  }, [attention, sessions, cwd])
}

function BranchList({ cwd, status, onPick, onCreate }: { cwd: string; status: BranchStatus; onPick: (b: BranchRef) => void; onCreate: (name: string) => void }) {
  const { t } = useTranslation()
  const [branches, setBranches] = useState<BranchRef[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void ipcClient.invoke('git.branches', { cwd }).then((r: { branches?: BranchRef[] }) => live && setBranches(r?.branches ?? []))
    // ShellPopover focuses its close button first; the search box is what you want to type in.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [cwd])

  const q = query.trim().toLowerCase()
  const match = (b: BranchRef) => !q || b.name.toLowerCase().includes(q)
  const local = (branches ?? []).filter((b) => !b.remote && match(b))
  const localNames = new Set((branches ?? []).filter((b) => !b.remote).map((b) => b.name))
  // A remote branch that already has a local twin is reached through the local one.
  const remote = (branches ?? []).filter((b) => b.remote && match(b) && !localNames.has(b.name.slice(b.name.indexOf('/') + 1)))
  const first = local.find((b) => !b.current && !b.worktree) ?? remote[0]

  const row = (b: BranchRef) => {
    const disabled = b.current || !!b.worktree
    return (
      <button
        key={`${b.remote ? 'r' : 'l'}:${b.name}`}
        type="button"
        role="option"
        aria-selected={b.current}
        disabled={disabled}
        title={b.worktree ? t('common:branches.inWorktree', { path: b.worktree }) : b.name}
        className={cn('branch-row', b.current && 'branch-row--current')}
        onClick={() => onPick(b)}
      >
        <span className="flex w-3.5 shrink-0 justify-center">{b.current ? <Check className="h-3.5 w-3.5" /> : null}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{b.name}</span>
        {b.worktree ? <span className="shrink-0 text-[11px] text-foreground-tertiary">{t('common:branches.worktree')}</span> : null}
        <span className="shrink-0 font-mono text-[11px] text-foreground-tertiary">{b.head}</span>
      </button>
    )
  }

  return (
    <div className="branch-picker flex flex-col gap-0.5">
      <input
        ref={inputRef}
        value={query}
        placeholder={creating ? t('common:branches.newPlaceholder') : t('common:branches.search')}
        aria-label={creating ? t('common:branches.new') : t('common:branches.search')}
        className="mb-1 h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-foreground-tertiary focus:border-[var(--focus-border)]"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (creating && query.trim()) onCreate(query.trim())
          else if (!creating && first) onPick(first)
        }}
      />
      {creating ? (
        <p className="px-1 pb-1 text-[11.5px] text-foreground-tertiary">{t('common:branches.newHint', { from: status.branch ?? status.head })}</p>
      ) : (
        <>
          {branches === null ? <p className="px-1 py-2 text-[12px] text-foreground-tertiary">{t('common:loading')}</p> : null}
          <div role="listbox" aria-label={t('common:branches.local')} className="flex flex-col">
            {local.map(row)}
          </div>
          {remote.length ? (
            <>
              <div className="px-1 pb-0.5 pt-2 text-[11px] text-foreground-tertiary">{t('common:branches.remote')}</div>
              <div role="listbox" aria-label={t('common:branches.remote')} className="flex flex-col">
                {remote.map(row)}
              </div>
            </>
          ) : null}
          {branches && !local.length && !remote.length ? <p className="px-1 py-2 text-[12px] text-foreground-tertiary">{t('common:branches.none')}</p> : null}
        </>
      )}
      <button
        type="button"
        className="branch-row mt-1 text-foreground-secondary"
        onClick={() => {
          if (creating && query.trim()) onCreate(query.trim())
          else {
            setCreating(true)
            inputRef.current?.focus()
          }
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        {creating && query.trim() ? t('common:branches.createNamed', { name: query.trim() }) : t('common:branches.new')}
      </button>
    </div>
  )
}

type Pending = { kind: 'running'; req: SwitchReq } | { kind: 'dirty'; req: SwitchReq; files: string[] } | null

/**
 * Status bar, left: the current project's branch (dirty dot, ahead / behind). Click → switch or create a
 * branch. Changes travel with the switch when git allows; otherwise the user may stash them first, and
 * gets them back when returning to the branch.
 */
export function BranchStatusTrigger() {
  const { t } = useTranslation()
  const cwd = useUIStore((s) => s.currentWorkspace)
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const running = useRunningHere(cwd)
  // Stable: ShellPopover re-focuses its close button whenever onClose changes.
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

  const run = async (req: SwitchReq) => {
    if (!cwd) return
    setBusy(true)
    try {
      const r = (await ipcClient.invoke('git.switchBranch', { cwd, ...req })) as SwitchRes
      if (r.ok) {
        const restorable = r.restorable
        if (restorable) {
          toast(t('common:branches.restorable'), {
            duration: 15_000,
            action: {
              label: t('common:branches.restore'),
              onClick: () =>
                void ipcClient.invoke('git.restoreStash', { cwd, ref: restorable.ref }).then((x: { ok: boolean; message?: string }) => {
                  if (x.ok) toast.success(t('common:branches.restored'))
                  else toast.error(t('common:branches.restoreFailed', { error: x.message ?? '' }))
                }),
            },
          })
        } else if (r.stashed) toast(t('common:branches.stashed'))
      } else if (r.reason === 'dirty-conflict') {
        setPending({ kind: 'dirty', req, files: r.files })
      } else {
        toast.error(t('common:branches.failed', { error: r.message }))
      }
    } catch (e) {
      toast.error(t('common:branches.failed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const start = (req: SwitchReq) => {
    setOpen(false)
    if (running > 0) setPending({ kind: 'running', req })
    else void run(req)
  }

  if (!cwd || !status?.isRepo) return null
  const label = status.branch ?? (status.head ? `${status.head.slice(0, 7)}` : t('common:branches.detached'))

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="workbench-status-trigger branch-status-trigger tabular-nums"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('common:branches.trigger', { branch: label })}
        title={[status.upstream ? `${label} → ${status.upstream}` : label, status.dirty ? t('common:branches.dirty', { count: status.dirty }) : ''].filter(Boolean).join(' · ')}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <GitBranch className={cn('h-3 w-3 shrink-0', busy && 'animate-pulse')} />
        <span className="max-w-[14rem] truncate">{label}</span>
        {status.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warn)]" aria-hidden /> : null}
        {status.ahead ? <span className="text-foreground-tertiary">↑{status.ahead}</span> : null}
        {status.behind ? <span className="text-foreground-tertiary">↓{status.behind}</span> : null}
      </button>
      {open ? (
        <ShellPopover title={t('common:branches.title')} anchorRef={anchor} onClose={closePicker}>
          <BranchList
            cwd={cwd}
            status={status}
            onPick={(b) => start({ name: b.name, remote: b.remote })}
            onCreate={(name) => start({ name, create: true })}
          />
        </ShellPopover>
      ) : null}
      <ConfirmDialog
        open={pending?.kind === 'running'}
        title={t('common:branches.runningTitle')}
        message={t('common:branches.runningMessage', { count: running })}
        confirmLabel={t('common:branches.switchAnyway')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const req = pending?.req
          setPending(null)
          if (req) void run(req)
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'dirty'}
        title={t('common:branches.dirtyTitle')}
        message={t('common:branches.dirtyMessage', { files: pending?.kind === 'dirty' ? pending.files.slice(0, 6).join(', ') + (pending.files.length > 6 ? ' …' : '') : '' })}
        confirmLabel={t('common:branches.stashAndSwitch')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const req = pending?.req
          setPending(null)
          if (req) void run({ ...req, stash: true })
        }}
      />
    </>
  )
}
