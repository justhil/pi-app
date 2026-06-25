import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { parseModelIdList, sanitizeModelId, validateModelId } from './model-id-utils'

export function ManualModelAddDialog({
  open,
  providerLabel,
  existingIds,
  onConfirm,
  onCancel,
}: {
  open: boolean
  providerLabel: string
  existingIds: Set<string>
  onConfirm: (ids: string[]) => void | Promise<void>
  onCancel: () => void
}) {
  const { t: tr } = useTranslation()
  const titleId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue('')
    setError(null)
    setBusy(false)
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
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

  const preview = () => {
    const ids = parseModelIdList(value)
    const valid: string[] = []
    const invalid: string[] = []
    const dup: string[] = []
    for (const id of ids) {
      const v = validateModelId(id)
      if (!v.ok) {
        invalid.push(id)
        continue
      }
      if (existingIds.has(id)) {
        dup.push(id)
        continue
      }
      valid.push(id)
    }
    return { valid, invalid, dup, rawCount: ids.length }
  }

  const submit = async () => {
    if (busy) return
    const single = sanitizeModelId(value)
    const ids =
      value.includes('\n') || value.includes(',') || value.includes(';')
        ? parseModelIdList(value)
        : single
          ? [single]
          : []
    if (!ids.length) {
      setError(tr('models:enterAtLeastOne'))
      return
    }
    const toAdd: string[] = []
    const problems: string[] = []
    for (const id of ids) {
      const v = validateModelId(id)
      if (!v.ok) {
        problems.push(`「${id}」${v.reason}`)
        continue
      }
      if (existingIds.has(id)) {
        problems.push(tr('models:alreadyExists', { id }))
        continue
      }
      toAdd.push(id)
    }
    if (!toAdd.length) {
      setError(problems[0] || tr('models:noModelToAdd'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onConfirm(toAdd)
    } finally {
      setBusy(false)
    }
  }

  const { valid, invalid, dup } = preview()

  return createPortal(
    <div
      className="electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-enter w-full max-w-md rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[15px] font-semibold text-foreground">
          {tr('models:manualAddTitle')}
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {tr('models:providerLabelPrefix')} <span className="font-medium text-foreground/90">{providerLabel}</span>
          {tr('models:manualAddHint')}
        </p>
        <textarea
          ref={inputRef}
          rows={3}
          disabled={busy}
          placeholder={tr('models:manualAddPlaceholder')}
          className="settings-field-focus mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
        />
        {value.trim() && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {tr('models:willAdd', { count: valid.length })}
            {dup.length > 0 && <span> · {tr('models:skipDuplicates', { count: dup.length })}</span>}
            {invalid.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · {tr('models:invalidFormat')} {invalid.length}</span>}
          </p>
        )}
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="settings-chip rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            onClick={onCancel}
          >
            {tr('models:cancelBtn')}
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            className="settings-chip rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? tr('models:adding') : valid.length > 1 ? tr('models:addCount', { count: valid.length }) : tr('models:add')}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/70">{tr('models:ctrlEnterHint')}</p>
      </div>
    </div>,
    document.body,
  )
}