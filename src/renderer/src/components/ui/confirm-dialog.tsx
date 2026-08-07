import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  /** 确认按钮文案，默认 common:confirm */
  confirmLabel?: string
  destructive?: boolean
  /** 为 true 时禁用按钮并忽略 Enter，防止重复提交 */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && !busy) onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm, busy])

  if (!open) return null

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
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-2 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="mb-4 text-base leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            onClick={onCancel}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50',
              destructive
                ? 'bg-destructive hover:bg-destructive/90'
                : 'bg-primary hover:bg-primary/90',
            )}
            onClick={onConfirm}
          >
            {confirmLabel || t('common:confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
