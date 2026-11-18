import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

const MIN_EDITOR_HEIGHT_PX = 76
const MAX_EDITOR_HEIGHT_PX = 420

export function MessageInlineEditor({
  initialText,
  role,
  align,
  forceAllowUnchanged = false,
  onSave,
  onCancel,
}: {
  initialText: string
  role: 'user' | 'assistant'
  align: 'left' | 'right'
  /** Allow saving identical text when promoting an interrupted/errored assistant row. */
  forceAllowUnchanged?: boolean
  onSave: (nextText: string) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const syncHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(Math.max(el.scrollHeight, MIN_EDITOR_HEIGHT_PX), MAX_EDITOR_HEIGHT_PX)
    el.style.height = `${next}px`
  }, [])

  useLayoutEffect(() => {
    syncHeight()
  }, [draft, syncHeight])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    try {
      el.setSelectionRange(end, end)
    } catch {
      /* ignore selection range errors in non-DOM test stubs */
    }
  }, [])

  const isMac =
    typeof window !== 'undefined' &&
    ((window as { piDesktop?: { platform?: string } }).piDesktop?.platform === 'darwin' ||
      /Mac|iPod|iPhone|iPad/.test(navigator.platform || ''))
  const modLabel = isMac ? '⌘' : 'Ctrl'

  const trimmed = draft.trim()
  const canSave = !saving && trimmed.length > 0

  const submit = useCallback(async () => {
    if (!canSave) return
    if (!forceAllowUnchanged && draft === initialText) {
      onCancel()
      return
    }
    setSaving(true)
    try {
      const ok = await onSave(draft)
      if (ok) onCancel()
    } finally {
      setSaving(false)
    }
  }, [canSave, draft, forceAllowUnchanged, initialText, onCancel, onSave])

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        align === 'right' ? 'items-end' : 'items-start',
      )}
    >
      <div
        className={cn(
          'flex flex-col rounded-[10px] border border-[color:var(--border-base)] bg-[var(--bg-1)] shadow-sm transition-colors focus-within:border-[color:var(--brand)]/55',
          align === 'right' ? 'w-full max-w-[min(100%,44rem)]' : 'w-full',
        )}
      >
        <textarea
          ref={textareaRef}
          data-independent-scroll
          data-testid={`message-inline-editor-${role}`}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              if (!saving) onCancel()
              return
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              e.stopPropagation()
              void submit()
            }
          }}
          placeholder={
            role === 'user'
              ? t('timeline:edit.placeholderUser')
              : t('timeline:edit.placeholderAssistant')
          }
          className="w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-3 py-2 text-[15px] leading-[1.65] text-foreground outline-none placeholder:text-foreground-secondary/60 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-base)]/60 px-2.5 py-1.5">
          <span className="select-none text-[11px] text-foreground-secondary">
            {t('timeline:edit.shortcutHint', { mod: modLabel })}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="h-6 rounded-md px-2.5 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {t('timeline:edit.cancel')}
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void submit()}
              className="h-6 rounded-md bg-[var(--brand)] px-2.5 text-[12px] font-medium text-white hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {saving ? t('timeline:edit.saving') : t('timeline:edit.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
