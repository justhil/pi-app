import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'

/**
 * 批量归档对话框：按“早于某日期”或“仅保留最近 N 个活跃会话”归档当前项目的未归档会话。
 * 结果通过 onDone(archivedCount) 返回；count<0 表示失败。
 */
export function BatchArchiveDialog({
  open,
  workspacePath,
  sandbox = false,
  onCancel,
  onDone,
}: {
  open: boolean
  /** 项目路径（sandbox 模式传空） */
  workspacePath: string
  /** true 时归档所有普通对话（sandbox boxes），而非单个项目目录 */
  sandbox?: boolean
  onCancel: () => void
  onDone: (archived: number) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'before' | 'keep'>('before')
  const [date, setDate] = useState('')
  const [keep, setKeep] = useState('10')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setMode('before')
    setDate('')
    setKeep('10')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const valid =
    mode === 'before' ? !!date : keep.trim() !== '' && /^\d*$/.test(keep)

  const run = async () => {
    if (busy || !valid) return
    const before =
      mode === 'before' ? new Date(`${date}T23:59:59.999`).getTime() : 0
    const keepN = mode === 'keep' ? Math.max(0, Math.floor(Number(keep) || 0)) : 0
    setBusy(true)
    try {
      const channel = sandbox ? 'workspace.sandbox.archiveBatch' : 'session.archiveBatch'
      const r = await ipcClient.invoke(channel, {
        ...(sandbox ? {} : { workspaceId: workspacePath }),
        ...(mode === 'before' ? { before } : { keepRecent: keepN }),
      })
      onDone(r?.ok ? Number(r.archived) || 0 : -1)
    } catch {
      onDone(-1)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-[14px] font-semibold text-foreground">
          {sandbox ? t('common:sidebar.batchArchiveSandboxTitle') : t('common:sidebar.batchArchive')}
        </h2>
        <p className="mb-3 text-[11px] text-foreground-secondary/80">
          {t('common:sidebar.batchArchiveHint')}
        </p>

        <label className="mb-2 flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="radio"
            checked={mode === 'before'}
            onChange={() => setMode('before')}
            className="accent-[var(--brand)]"
          />
          {t('common:sidebar.batchArchiveBefore')}
        </label>
        {mode === 'before' && (
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        <label className="mb-2 flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="radio"
            checked={mode === 'keep'}
            onChange={() => setMode('keep')}
            className="accent-[var(--brand)]"
          />
          {t('common:sidebar.batchArchiveKeepRecent')}
        </label>
        {mode === 'keep' && (
          <>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={keep}
              disabled={busy}
              placeholder="0"
              onChange={(e) => setKeep(e.target.value.replace(/\D/g, ''))}
              className="mb-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mb-3 text-[11px] text-foreground-secondary/70">
              {t('common:sidebar.batchArchiveZeroHint')}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] text-foreground-secondary hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            onClick={onCancel}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !valid}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void run()}
          >
            <Archive className="h-3.5 w-3.5" />
            {busy ? t('common:loading') : t('common:sidebar.batchArchiveRun')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
