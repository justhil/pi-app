import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

export function ConfirmDialog({
  open,
  title,
  message,
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

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
        <h2 id={titleId} className="mb-2 text-[14px] font-semibold text-foreground">
          {title}
        </h2>
        <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[13px] text-foreground-secondary hover:bg-accent hover:text-accent-foreground"
            onClick={onCancel}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] text-white',
              destructive
                ? 'bg-destructive hover:bg-destructive/90'
                : 'bg-primary hover:bg-primary/90',
            )}
            onClick={onConfirm}
          >
            {t('common:confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
