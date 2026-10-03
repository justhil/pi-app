// Thinking level picker (/thinking and the composer chip): every pi level incl. `max`, levels the
// current model cannot use are disabled, and the level can be bound to the model (pi
// `modelThinkingLevels`, applied whenever the session switches to that model).

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
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
import { nearestUsableStop, stepUsableStop } from './thinking-slider-math'

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
  const trackRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  // Level shown while dragging; committed on release so one drag is one switch.
  const [preview, setPreview] = useState<string | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (!open) return
    setBound(boundThinkingLevelFor(model))
    void loadModelThinkingBindings(true).then(() => setBound(boundThinkingLevelFor(model)))
    return subscribeModelThinkingBindings(() => setBound(boundThinkingLevelFor(model)))
  }, [open, model])

  useEffect(() => {
    if (!open) return
    // Keyboard lands on the slider: ←/→ change the level right away.
    const frame = requestAnimationFrame(() => sliderRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  if (!open) return null

  const supported = (level: string) => !available || available.length === 0 || available.includes(level)
  const usable = THINKING_LEVELS.map((level) => supported(level))
  const shown = preview ?? current
  const shownIndex = Math.max(0, THINKING_LEVELS.indexOf(shown as (typeof THINKING_LEVELS)[number]))
  const pct = (i: number) => `${(i / (THINKING_LEVELS.length - 1)) * 100}%`

  const commit = (level: string) => {
    setPreview(null)
    if (level !== current && supported(level)) void applyThinkingLevel(level)
  }

  const levelAt = (clientX: number): string | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const i = nearestUsableStop((clientX - rect.left) / rect.width, THINKING_LEVELS.length, usable)
    return i < 0 ? null : THINKING_LEVELS[i]
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const level = levelAt(e.clientX)
    if (level) setPreview(level)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const level = levelAt(e.clientX)
    if (level && level !== preview) setPreview(level)
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    commit(preview ?? current)
  }

  const onSliderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = THINKING_LEVELS.indexOf(current as (typeof THINKING_LEVELS)[number])
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = stepUsableStop(i, 1, usable)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = stepUsableStop(i, -1, usable)
    else if (e.key === 'Home') next = usable.indexOf(true)
    else if (e.key === 'End') next = usable.lastIndexOf(true)
    else if (e.key === 'Enter') {
      e.preventDefault()
      setOpen(false)
      return
    } else return
    e.preventDefault()
    if (next >= 0) commit(THINKING_LEVELS[next])
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

  return (
    <ComposerPopover
      anchorSelector="[data-composer-thinking-chip]"
      width={232}
      label={t('composer:thinkingPicker.title')}
      onClose={() => setOpen(false)}
      className="thinking-picker"
    >
        <div className="px-3 pt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-muted-foreground/70">{t('composer:thinkingPicker.title')}</span>
            <span className="text-[12px] text-foreground">
              {formatThinkingChip(shown)}
              {bound === shown ? <span className="ml-1.5 text-[10px] text-primary">{t('composer:thinkingPicker.bound')}</span> : null}
            </span>
          </div>

          {/* Slider: one stop per pi level; unusable levels are hollow and skipped. */}
          <div
            ref={sliderRef}
            role="slider"
            tabIndex={0}
            aria-label={t('composer:thinkingPicker.title')}
            aria-valuemin={0}
            aria-valuemax={THINKING_LEVELS.length - 1}
            aria-valuenow={shownIndex}
            aria-valuetext={formatThinkingChip(shown)}
            onKeyDown={onSliderKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragging.current = false
              setPreview(null)
            }}
            className="thinking-slider group relative mt-2 h-5 cursor-pointer touch-none outline-none"
          >
            <div ref={trackRef} className="absolute inset-x-1.5 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-foreground/10">
              <div className="thinking-slider-fill absolute inset-y-0 left-0 rounded-full bg-foreground/65" style={{ width: pct(shownIndex) }} />
              {/* Stops ahead of the value only; the filled part stays one clean line. */}
              {THINKING_LEVELS.map((level, i) =>
                i <= shownIndex && usable[i] ? null : (
                  <span
                    key={level}
                    className={cn(
                      'absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                      usable[i] ? 'bg-foreground/30' : 'border border-foreground/30 bg-popover',
                    )}
                    style={{ left: pct(i) }}
                  />
                ),
              )}
              <span
                className="thinking-slider-thumb absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/15 bg-background shadow-[0_1px_3px_rgba(0,0,0,0.2)] group-focus-visible:ring-2 group-focus-visible:ring-ring/40"
                style={{ left: pct(shownIndex) }}
              />
            </div>
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/50">
            <span>{formatThinkingChip('off')}</span>
            <span>{formatThinkingChip('max')}</span>
          </div>
          <div className="mb-2 mt-1.5 truncate text-[11px] text-muted-foreground/75">
            {supported(shown) ? t(`composer:thinkingPicker.desc.${shown}`) : t('composer:thinkingPicker.unsupported')}
          </div>
        </div>

        <div
          className="flex items-center gap-2 border-t border-border/50 px-3 py-1"
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
