import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'

/**
 * 批量取消归档对话框：仅保留最近归档的 N 个会话（N=0 → 全部恢复），其余恢复。
 * 结果通过 onDone(restoredCount) 返回；count<0 表示失败。
 */
export function BatchRestoreDialog({
  open,
  title,
  sessionFiles,
  onCancel,
  onDone,
}: {
  open: boolean
  title: string
  /** 作用域内全部已归档会话的文件路径 */
  sessionFiles: string[]
  onCancel: () => void
  onDone: (restored: number) => void
}) {
  const { t } = useTranslation()
  const [keep, setKeep] = useState('0')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setKeep('0')
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

  const valid = keep.trim() !== '' && /^\d*$/.test(keep)

  const run = async () => {
    if (busy || !valid) return
    const n = Math.max(0, Math.floor(Number(keep) || 0))
    setBusy(true)
    try {
      const r = await ipcClient.invoke('session.restoreBatch', {
        sessionFiles,
        keepRecent: n,
      })
      onDone(r?.ok ? Number(r.restored) || 0 : -1)
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
          {t('common:sidebar.batchRestoreTitle')}
        </h2>
        <p className="mb-3 truncate text-[11px] text-foreground-secondary/80" title={title}>
          {title}
        </p>

        <label className="mb-2 block text-[13px] text-foreground">
          {t('common:sidebar.batchRestoreKeepRecent')}
        </label>
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
          {t('common:sidebar.batchRestoreHint', { count: sessionFiles.length })}
        </p>

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
            <RotateCcw className="h-3.5 w-3.5" />
            {busy ? t('common:loading') : t('common:sidebar.batchRestoreRun')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
