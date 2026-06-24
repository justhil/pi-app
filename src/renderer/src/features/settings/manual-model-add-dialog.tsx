import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
      setError('请输入至少一个模型 id')
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
        problems.push(`「${id}」已在列表中`)
        continue
      }
      toAdd.push(id)
    }
    if (!toAdd.length) {
      setError(problems[0] || '没有可添加的模型')
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
          手动添加模型
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          供应商 <span className="font-medium text-foreground/90">{providerLabel}</span>
          ，id 与 API 请求一致。可多行或逗号分隔批量添加。
        </p>
        <textarea
          ref={inputRef}
          rows={3}
          disabled={busy}
          placeholder="例如 gpt-4.1-mini 或每行一个 id"
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
            将添加 <strong className="text-foreground">{valid.length}</strong> 个
            {dup.length > 0 && <span> · 跳过已存在 {dup.length}</span>}
            {invalid.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · 格式无效 {invalid.length}</span>}
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
            取消
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            className="settings-chip rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? '添加中…' : valid.length > 1 ? `添加 ${valid.length} 个` : '添加'}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/70">Ctrl+Enter 确认</p>
      </div>
    </div>,
    document.body,
  )
}