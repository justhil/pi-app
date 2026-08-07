import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles } from '@renderer/components/icons'

export function RenamePromptDialog({
  open,
  title,
  defaultValue,
  placeholder,
  autoNameTarget,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  defaultValue: string
  placeholder?: string
  /** 传入后显示「自动生成」按钮：调用 session.autoNamePreview 填充标题 */
  autoNameTarget?: { sessionFile: string } | null
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    setBusy(false)
    setGenerating(false)
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open, defaultValue])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const submit = async () => {
    if (busy) return
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await onConfirm(trimmed)
    } finally {
      setBusy(false)
    }
  }

  const autoGenerate = async () => {
    if (generating || !autoNameTarget) return
    setGenerating(true)
    try {
      const { ipcClient } = await import('@renderer/lib/ipc-client')
      const r = await ipcClient.invoke('session.autoNamePreview', {
        sessionFile: autoNameTarget.sessionFile,
      })
      const next = r?.title
      if (typeof next === 'string' && next.trim()) {
        setValue(next.trim())
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    } catch (e) {
      console.warn('[rename] autoNamePreview failed:', e)
    } finally {
      setGenerating(false)
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
        aria-labelledby={`${inputId}-title`}
        className="w-full max-w-sm rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id={`${inputId}-title`} className="mb-3 text-[14px] font-semibold text-foreground">
          {title}
        </h2>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value}
          disabled={busy}
          placeholder={placeholder}
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <div className="flex justify-end gap-2">
          {autoNameTarget && (
            <button
              type="button"
              disabled={generating || busy}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-foreground-secondary hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={() => void autoGenerate()}
              title={t('common:sidebar.autoNameHint')}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generating ? t('common:loading') : t('common:sidebar.autoGenerate')}
            </button>
          )}
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
            disabled={busy || !value.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void submit()}
          >
            {t('common:confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}