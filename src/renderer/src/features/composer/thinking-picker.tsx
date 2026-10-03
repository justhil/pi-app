// Thinking level picker (/thinking and the composer chip): every pi level incl. `max`, levels the
// current model cannot use are disabled, and the level can be bound to the model (pi
// `modelThinkingLevels`, applied whenever the session switches to that model).

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { Check } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { ComposerPopover } from './composer-popover'
import { formatThinkingChip, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import {
  boundThinkingLevelFor,
  loadModelThinkingBindings,
  setModelThinkingBinding,
  subscribeModelThinkingBindings,
} from '@renderer/lib/model-thinking-bindings'

import { THINKING_LEVELS, applyThinkingLevel } from './thinking-level-actions'

export { THINKING_LEVELS }

export function ThinkingPicker() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.thinkingPickerOpen)
  const setOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const current = normalizeThinkingLevel(useUIStore((s) => s.runState.thinkingLevel)) ?? 'medium'
  const available = useUIStore((s) => s.runState.availableThinkingLevels)
  const model = useUIStore((s) => s.runState.model) || ''
  const [bound, setBound] = useState(() => boundThinkingLevelFor(model))
  const [bindBusy, setBindBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setBound(boundThinkingLevelFor(model))
    void loadModelThinkingBindings(true).then(() => setBound(boundThinkingLevelFor(model)))
    return subscribeModelThinkingBindings(() => setBound(boundThinkingLevelFor(model)))
  }, [open, model])

  useEffect(() => {
    if (!open) return
    // Land keyboard focus on the active level so ↑/↓ + Enter work immediately.
    const frame = requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('[data-current]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, setOpen])

  if (!open) return null

  const supported = (level: string) => !available || available.length === 0 || available.includes(level)

  const pick = async (level: string) => {
    if (!supported(level)) return
    setOpen(false)
    await applyThinkingLevel(level)
  }

  const toggleBinding = async (next: boolean) => {
    if (!model || bindBusy) return
    setBindBusy(true)
    try {
      await setModelThinkingBinding(model, next ? current : null)
      setBound(next ? current : undefined)
      toast.success(
        next
          ? t('composer:thinkingPicker.boundToast', { model, level: formatThinkingChip(current) })
          : t('composer:thinkingPicker.unboundToast', { model }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBindBusy(false)
    }
  }

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
    next?.focus()
  }

  return (
    <ComposerPopover
      anchorSelector="[data-composer-thinking-chip]"
      width={208}
      label={t('composer:thinkingPicker.title')}
      onClose={() => setOpen(false)}
      className="thinking-picker"
    >
        <div className="flex items-center px-2.5 pb-0.5 pt-1.5 text-[10.5px] text-muted-foreground/65">
          <span className="min-w-0 flex-1 truncate">{t('composer:thinkingPicker.title')}</span>
          <span className="text-[10px] text-muted-foreground/50">Shift+Tab</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1 pt-0.5" role="listbox" onKeyDown={onListKeyDown}>
          {THINKING_LEVELS.map((level) => {
            const active = current === level
            const usable = supported(level)
            return (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={active}
                disabled={!usable}
                data-current={active || undefined}
                onClick={() => void pick(level)}
                title={usable ? undefined : t('composer:thinkingPicker.unsupported')}
                className={cn(
                  'thinking-picker-row picker-row flex h-[26px] w-full items-center gap-2 px-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45',
                  active && 'bg-[var(--bg-active)]',
                )}
              >
                <span className={cn('w-[52px] shrink-0 text-[12px]', active ? 'text-foreground' : 'text-foreground/80')}>
                  {formatThinkingChip(level)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground/60">
                  {usable ? t(`composer:thinkingPicker.desc.${level}`) : t('composer:thinkingPicker.unsupported')}
                </span>
                {bound === level ? (
                  <span className="shrink-0 text-[10px] text-primary">{t('composer:thinkingPicker.bound')}</span>
                ) : null}
                {active ? <Check className="thinking-picker-check h-3 w-3 shrink-0 text-primary" /> : <span className="w-3 shrink-0" />}
              </button>
            )
          })}
        </div>

        <div
          className="flex items-center gap-2 border-t border-border/50 px-2.5 py-1"
          title={model ? t('composer:thinkingPicker.bindHint', { model }) : t('composer:thinkingPicker.bindNoModel')}
        >
          <div className="min-w-0 flex-1 truncate text-[11px] text-foreground-secondary">{t('composer:thinkingPicker.bindLabel')}</div>
          <Switch
            checked={!!bound}
            disabled={!model || bindBusy}
            aria-label={t('composer:thinkingPicker.bindLabel')}
            onCheckedChange={(next) => void toggleBinding(next)}
            className="origin-right scale-75"
          />
        </div>
    </ComposerPopover>
  )
}
