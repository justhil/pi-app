// Thinking level picker (/thinking and the composer chip): every pi level incl. `max`, levels the
// current model cannot use are disabled, and the level can be bound to the model (pi
// `modelThinkingLevels`, applied whenever the session switches to that model).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { Brain, Check } from '@renderer/components/icons'
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
const METER_STEPS = THINKING_LEVELS.length - 1

function ThinkingMeter({ index, active }: { index: number; active: boolean }) {
  return (
    <span className="thinking-meter" data-active={active || undefined} aria-hidden>
      {Array.from({ length: METER_STEPS }, (_, step) => (
        <span key={step} data-on={step < index || undefined} style={{ '--step': step } as CSSProperties} />
      ))}
    </span>
  )
}

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
      width={272}
      label={t('composer:thinkingPicker.title')}
      onClose={() => setOpen(false)}
      className="thinking-picker"
    >
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground/80">
          <Brain className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate">{t('composer:thinkingPicker.title')}</span>
          <span className="text-[10.5px] font-normal text-muted-foreground/55">Shift+Tab</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" onKeyDown={onListKeyDown}>
          {THINKING_LEVELS.map((level, index) => {
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
                  'thinking-picker-row picker-row flex w-full items-center gap-2.5 px-3 py-1.5 text-left disabled:cursor-not-allowed',
                  active && 'bg-[var(--bg-active)]',
                )}
                style={{ '--row': index } as CSSProperties}
              >
                <ThinkingMeter index={index} active={active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[12.5px]', active ? 'font-semibold text-foreground' : 'font-medium')}>
                      {formatThinkingChip(level)}
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground/55">{level}</span>
                    {bound === level ? (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary">
                        {t('composer:thinkingPicker.bound')}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground/70">
                    {usable ? t(`composer:thinkingPicker.desc.${level}`) : t('composer:thinkingPicker.unsupported')}
                  </div>
                </div>
                {active ? <Check className="thinking-picker-check h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-border/60 bg-[color-mix(in_srgb,var(--bg-1)_60%,transparent)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium">{t('composer:thinkingPicker.bindLabel')}</div>
            <div className="truncate text-[11px] text-muted-foreground/70" title={model}>
              {model ? t('composer:thinkingPicker.bindHint', { model }) : t('composer:thinkingPicker.bindNoModel')}
            </div>
          </div>
          <Switch
            checked={!!bound}
            disabled={!model || bindBusy}
            aria-label={t('composer:thinkingPicker.bindLabel')}
            onCheckedChange={(next) => void toggleBinding(next)}
          />
        </div>
    </ComposerPopover>
  )
}
