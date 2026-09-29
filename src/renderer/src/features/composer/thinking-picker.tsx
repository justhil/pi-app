// Thinking level picker (/thinking and the composer chip): every pi level incl. `max`, levels the
// current model cannot use are disabled, and the level can be bound to the model (pi
// `modelThinkingLevels`, applied whenever the session switches to that model).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Brain, Check } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { formatThinkingChip, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { commitSessionDisplayMeta } from '@renderer/lib/session-display-meta'
import {
  boundThinkingLevelFor,
  loadModelThinkingBindings,
  setModelThinkingBinding,
  subscribeModelThinkingBindings,
} from '@renderer/lib/model-thinking-bindings'

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
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
  const sessionFile = useUIStore((s) => s.historySessionFile)
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Land keyboard focus on the active level so ↑/↓ + Enter work immediately.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('[data-current]')?.focus())
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const supported = (level: string) => !available || available.length === 0 || available.includes(level)

  const pick = async (level: string) => {
    if (!supported(level)) return
    const previous = useUIStore.getState().runState.thinkingLevel
    useUIStore.getState().setRunState({ thinkingLevel: level })
    setOpen(false)
    if (bound && model && bound !== level) {
      void setModelThinkingBinding(model, level).catch(() => {})
    }
    try {
      await ipcClient.invoke('thinkingLevel.set', {
        sessionId: '',
        sessionFile: sessionFile ?? undefined,
        level,
      })
      commitSessionDisplayMeta(sessionFile, { thinkingLevel: level })
      toast.success(t('composer:thinkingPicker.switched', { level: formatThinkingChip(level) }))
    } catch (e) {
      const isWorkerNotStarted = e instanceof Error && e.message.toLowerCase().includes('worker not started')
      if (isWorkerNotStarted) return
      console.error('thinkingLevel.set failed:', e)
      useUIStore.getState().setRunState({ thinkingLevel: previous })
      toast.error(t('composer:switchThinkingFailed'))
    }
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
    <div
      className="picker-backdrop backdrop-motion fixed inset-0 z-[110] flex items-end justify-center bg-black/40 p-4 pb-28 sm:items-start sm:pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="picker-panel thinking-picker w-full max-w-md overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl"
        style={{ boxShadow: '0 16px 48px color-mix(in srgb, var(--foreground) 12%, transparent)' }}
        role="dialog"
        aria-label={t('composer:thinkingPicker.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Brain className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{t('composer:thinkingPicker.title')}</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground/70">{t('composer:thinkingPicker.subtitle')}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('common:close')}
            className="row-hover rounded-lg p-1.5 text-foreground-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="py-1" role="listbox" onKeyDown={onListKeyDown}>
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
                  'thinking-picker-row picker-row flex w-full items-center gap-3 px-4 py-2 text-left disabled:cursor-not-allowed',
                  active && 'bg-[var(--bg-active)]',
                )}
                style={{ '--row': index } as CSSProperties}
              >
                <ThinkingMeter index={index} active={active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[13px]', active ? 'font-semibold text-foreground' : 'font-medium')}>
                      {formatThinkingChip(level)}
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground/55">{level}</span>
                    {bound === level ? (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary">
                        {t('composer:thinkingPicker.bound')}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground/70">
                    {usable ? t(`composer:thinkingPicker.desc.${level}`) : t('composer:thinkingPicker.unsupported')}
                  </div>
                </div>
                {active ? <Check className="thinking-picker-check h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-border/60 bg-[color-mix(in_srgb,var(--bg-1)_60%,transparent)] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium">{t('composer:thinkingPicker.bindLabel')}</div>
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
      </div>
    </div>
  )
}
