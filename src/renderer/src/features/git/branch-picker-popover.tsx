import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowRight, Check, Plus } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ShellPopover } from '@renderer/features/shell/shell-popover'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathsEqual } from '@shared/workspace-path'

export type BranchRef = {
  name: string
  remote: boolean
  head: string
  date: number
  upstream: string | null
  current: boolean
  worktree: string | null
}

type SwitchReq = { name: string; remote?: boolean; create?: boolean; stash?: boolean; force?: boolean }
type SwitchRes =
  | { ok: true; branch: string; stashed: boolean; restorable?: { ref: string; message: string } | null }
  | { ok: false; reason: 'dirty-conflict'; files: string[] }
  | { ok: false; reason: 'checkout-busy'; busyCount: number; message: string }
  | { ok: false; reason: 'invalid-name' | 'git'; message: string }

type Pending = { kind: 'running'; req: SwitchReq } | { kind: 'dirty'; req: SwitchReq; files: string[] } | null

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

function BranchList({
  cwd,
  currentBranchHint,
  onPick,
  onJumpWorktree,
  onCreate,
}: {
  cwd: string
  currentBranchHint?: string | null
  onPick: (b: BranchRef) => void
  onJumpWorktree: (worktreePath: string) => void
  onCreate: (name: string) => void
}) {
  const { t } = useTranslation()
  const [branches, setBranches] = useState<BranchRef[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void ipcClient
      .invoke('git.branches', { cwd })
      .then((r: { branches?: BranchRef[] }) => live && setBranches(r?.branches ?? []))
      .catch(() => live && setBranches([]))
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
  const remote = (branches ?? []).filter(
    (b) => b.remote && match(b) && !localNames.has(b.name.slice(b.name.indexOf('/') + 1)),
  )
  const first = local.find((b) => !b.current) ?? remote[0]
  const activeHeadLabel =
    currentBranchHint || local.find((b) => b.current)?.name || local[0]?.head || 'HEAD'

  const row = (b: BranchRef) => {
    const isOtherWorktree = Boolean(b.worktree && !workspacePathsEqual(b.worktree, cwd))
    const disabled = b.current
    return (
      <button
        key={`${b.remote ? 'r' : 'l'}:${b.name}`}
        type="button"
        role="option"
        aria-selected={b.current}
        disabled={disabled}
        title={isOtherWorktree ? t('common:branches.inWorktree', { path: b.worktree! }) : b.name}
        className={cn('branch-row', b.current && 'branch-row--current')}
        onClick={() => {
          if (isOtherWorktree && b.worktree) onJumpWorktree(b.worktree)
          else onPick(b)
        }}
      >
        <span className="flex w-3.5 shrink-0 justify-center">
          {b.current ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{b.name}</span>
        {isOtherWorktree ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[var(--bg-2)] px-1.5 py-0.2 text-[10.5px] text-foreground-secondary">
            <span>{t('common:branches.worktree')}</span>
            <ArrowRight className="h-2.5 w-2.5" />
          </span>
        ) : null}
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
          else if (!creating && first) {
            const otherWt = Boolean(first.worktree && !workspacePathsEqual(first.worktree, cwd))
            if (otherWt && first.worktree) onJumpWorktree(first.worktree)
            else onPick(first)
          }
        }}
      />
      {creating ? (
        <p className="px-1 pb-1 text-[11.5px] text-foreground-tertiary">
          {t('common:branches.newHint', { from: activeHeadLabel })}
        </p>
      ) : (
        <>
          {branches === null ? (
            <p className="px-1 py-2 text-[12px] text-foreground-tertiary">{t('common:loading')}</p>
          ) : null}
          <div role="listbox" aria-label={t('common:branches.local')} className="flex flex-col">
            {local.map(row)}
          </div>
          {remote.length ? (
            <>
              <div className="px-1 pb-0.5 pt-2 text-[11px] text-foreground-tertiary">
                {t('common:branches.remote')}
              </div>
              <div role="listbox" aria-label={t('common:branches.remote')} className="flex flex-col">
                {remote.map(row)}
              </div>
            </>
          ) : null}
          {branches && !local.length && !remote.length ? (
            <p className="px-1 py-2 text-[12px] text-foreground-tertiary">{t('common:branches.none')}</p>
          ) : null}
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
        {creating && query.trim()
          ? t('common:branches.createNamed', { name: query.trim() })
          : t('common:branches.new')}
      </button>
    </div>
  )
}

/**
 * Shared branch inspection, switching, creation & Worktree jump popover.
 * Reused by both the Composer context bar (BranchStatusTrigger) and Left Sidebar project rows.
 */
export function BranchPickerPopover({
  cwd,
  open,
  anchorRef,
  onClose,
  currentBranchHint,
  onBusyChange,
  onSwitched,
}: {
  cwd: string
  open: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  currentBranchHint?: string | null
  onBusyChange?: (busy: boolean) => void
  onSwitched?: (branch: string) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending>(null)
  const running = useRunningHere(cwd)

  const run = async (req: SwitchReq) => {
    onBusyChange?.(true)
    try {
      const r = (await ipcClient.invoke('git.switchBranch', { cwd, ...req })) as SwitchRes
      if (r.ok) {
        window.dispatchEvent(new CustomEvent('pi-desktop:git-branch-switched', { detail: { cwd, branch: r.branch } }))
        onSwitched?.(r.branch)
        const restorable = r.restorable
        if (restorable) {
          toast(t('common:branches.restorable'), {
            duration: 15_000,
            action: {
              label: t('common:branches.restore'),
              onClick: () =>
                void ipcClient
                  .invoke('git.restoreStash', { cwd, ref: restorable.ref })
                  .then((x: { ok: boolean; message?: string }) => {
                    if (x.ok) toast.success(t('common:branches.restored'))
                    else toast.error(t('common:branches.restoreFailed', { error: x.message ?? '' }))
                  }),
            },
          })
        } else if (r.stashed) toast(t('common:branches.stashed'))
      } else if (r.reason === 'checkout-busy') {
        setPending({ kind: 'running', req })
      } else if (r.reason === 'dirty-conflict') {
        setPending({ kind: 'dirty', req, files: r.files })
      } else {
        toast.error(t('common:branches.failed', { error: r.message }))
      }
    } catch (e) {
      toast.error(t('common:branches.failed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      onBusyChange?.(false)
    }
  }

  const start = (req: SwitchReq) => {
    onClose()
    if (running > 0) setPending({ kind: 'running', req })
    else void run(req)
  }

  const jumpWorktree = (wtPath: string) => {
    onClose()
    void activateWorkspace(wtPath)
  }

  return (
    <>
      {open ? (
        <ShellPopover title={t('common:branches.title')} anchorRef={anchorRef as RefObject<HTMLButtonElement>} onClose={onClose}>
          <BranchList
            cwd={cwd}
            currentBranchHint={currentBranchHint}
            onPick={(b) => start({ name: b.name, remote: b.remote })}
            onJumpWorktree={jumpWorktree}
            onCreate={(name) => start({ name, create: true })}
          />
        </ShellPopover>
      ) : null}

      <ConfirmDialog
        open={pending?.kind === 'running'}
        title={t('common:branches.runningTitle')}
        message={t('common:branches.runningMessage', { count: Math.max(running, 1) })}
        confirmLabel={t('common:branches.openInWorktree')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const req = pending?.req
          setPending(null)
          if (!req || !cwd) return
          const targetBranch = req.name.replace(/^origin\//, '')
          void (async () => {
            onBusyChange?.(true)
            try {
              const created = (await ipcClient.invoke('desktop.createGitWorktree', {
                workspaceId: cwd,
                branch: targetBranch,
              })) as { ok?: boolean; path?: string; error?: string }
              if (created?.ok && created.path) {
                toast.success(t('common:branches.worktreeCreated', { branch: targetBranch }))
                onSwitched?.(targetBranch)
                await activateWorkspace(created.path, { preferHome: true })
              } else {
                toast.error(created?.error || t('common:branches.failed', { error: '' }))
              }
            } finally {
              onBusyChange?.(false)
            }
          })()
        }}
      />

      <ConfirmDialog
        open={pending?.kind === 'dirty'}
        title={t('common:branches.dirtyTitle')}
        message={t('common:branches.dirtyMessage', {
          files:
            pending?.kind === 'dirty'
              ? pending.files.slice(0, 6).join(', ') + (pending.files.length > 6 ? ' …' : '')
              : '',
        })}
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
