import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ACCENT_PRESENCES,
  BACKDROP_PRESETS,
  FRAME_STYLES,
  MESSAGE_STYLES,
  normalizeCustomTheme,
  SHIKI_THEME_IDS,
  SURFACE_MATERIALS,
  THEME_DENSITIES,
  type CustomTheme,
  type ShikiThemeId,
  type ThemeAccentPresence,
  type ThemeBackdropPreset,
  type ThemeDensity,
  type ThemeFrameStyle,
  type ThemeMessageStyle,
  type ThemeSurfaceMaterial,
  type ThemeVariant,
  type ThemeVariantKey,
} from '@shared/custom-theme'
import { ipcClient } from '@renderer/lib/ipc-client'
import { applyCustomTheme } from '@renderer/lib/theme/inject-theme'
import { generateThemeCss } from '@renderer/lib/theme/generate-theme-css'
import { CUSTOM_THEME_CSS_CACHE_KEY } from '@shared/custom-theme'
import { presetsFor, presetVariant } from '@renderer/lib/theme/presets'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { Check, RotateCcw, Sparkles, X } from '@renderer/components/icons'

const DEFAULT_FALLBACK: Record<ThemeVariantKey, ThemeVariant> = {
  light: {
    preset: null,
    accent: '#0d74ce',
    surface: '#ffffff',
    ink: '#12141a',
    contrast: 45,
    fontUi: null,
    fontCode: null,
    translucentSidebar: true,
  },
  dark: {
    preset: null,
    accent: '#4da3ff',
    surface: '#141518',
    ink: '#f2f4f8',
    contrast: 60,
    fontUi: null,
    fontCode: null,
    translucentSidebar: false,
  },
}

/**
 * Floating live theme inspector docked on the right side of the actual conversation view.
 * Changes apply at 60fps over real chat messages, code blocks, and the composer dock.
 */
export function LiveThemeStudio({
  open,
  initialTheme,
  onClose,
}: {
  open: boolean
  initialTheme?: CustomTheme
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<CustomTheme>({})
  const [working, setWorking] = useState<CustomTheme>({})
  const [mode, setMode] = useState<ThemeVariantKey>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    if (!open) return
    let live = true
    const init = async () => {
      const res = await ipcClient.invoke('settings.get', { key: 'customTheme' }).catch(() => ({ settings: {} }))
      if (!live) return
      const diskTheme = normalizeCustomTheme(res?.settings?.customTheme)
      const startTheme = initialTheme && (initialTheme.light || initialTheme.dark) ? initialTheme : diskTheme
      setSnapshot(diskTheme)
      setWorking(startTheme)
      applyCustomTheme(startTheme)
      setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    }
    void init()
    return () => {
      live = false
    }
  }, [open, initialTheme])

  if (!open) return null

  const activeVariant: ThemeVariant = working[mode] ?? DEFAULT_FALLBACK[mode]

  const updateVariant = (patch: Partial<ThemeVariant>) => {
    const nextVariant: ThemeVariant = {
      ...activeVariant,
      preset: patch.preset !== undefined ? patch.preset : null,
      ...patch,
    }
    const nextTheme: CustomTheme = { ...working, [mode]: nextVariant }
    setWorking(nextTheme)
    applyCustomTheme(nextTheme)
  }

  const switchMode = (target: ThemeVariantKey) => {
    setMode(target)
    document.documentElement.classList.toggle('dark', target === 'dark')
    useUIStore.getState().setTheme(target)
    void ipcClient.invoke('settings.set', { key: 'theme', value: target }).catch(() => {})
    applyCustomTheme(working)
  }

  const pickPreset = (id: string) => {
    if (id === 'default') {
      const next = { ...working }
      delete next[mode]
      setWorking(next)
      applyCustomTheme(next)
      return
    }
    const pv = presetVariant(id, mode)
    if (pv) {
      const next = { ...working, [mode]: pv }
      setWorking(next)
      applyCustomTheme(next)
    }
  }

  const handleSave = async () => {
    const value = working.light || working.dark ? working : null
    await ipcClient.invoke('settings.set', { key: 'customTheme', value })
    try {
      const css = generateThemeCss(working)
      if (css) localStorage.setItem(CUSTOM_THEME_CSS_CACHE_KEY, css)
      else localStorage.removeItem(CUSTOM_THEME_CSS_CACHE_KEY)
    } catch {
      /* ignore */
    }
    setSnapshot(working)
    toast.success(t('settings:appearance.studioSaved'))
    onClose()
  }

  const handleRevert = () => {
    setWorking(snapshot)
    applyCustomTheme(snapshot)
  }

  const contentW = activeVariant.contentWidth ?? 820

  return createPortal(
    <aside
      aria-label={t('settings:appearance.studioTitle')}
      className="live-theme-studio fixed right-3 top-12 bottom-9 z-[120] flex w-[316px] flex-col overflow-hidden rounded-xl border border-border bg-[var(--bg-base)]/95 text-foreground shadow-2xl backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
          <span>{t('settings:appearance.studioTitle')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="settings-segmented flex h-6 gap-0.5 rounded p-0.5 text-[11px]">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'light'}
              onClick={() => switchMode('light')}
              className="settings-segmented-item rounded-[3px] px-2"
            >
              Light
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'dark'}
              onClick={() => switchMode('dark')}
              className="settings-segmented-item rounded-[3px] px-2"
            >
              Dark
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Controls scroll body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 text-[11.5px]">
        {/* Presets */}
        <div>
          <div className="mb-1.5 font-medium text-muted-foreground">{t('settings:appearance.preset')}</div>
          <div className="flex flex-wrap gap-1">
            {presetsFor(mode).map((p) => {
              const active = (working[mode]?.preset ?? 'default') === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPreset(p.id)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-[var(--brand)] bg-[var(--brand)]/12 font-medium text-foreground'
                      : 'border-border bg-background/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`settings:appearance.presets.${p.labelKey}`)}
                </button>
              )
            })}
          </div>
        </div>

        {/* Core Palette */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['accent', t('settings:appearance.accent')],
              ['surface', t('settings:appearance.surface')],
              ['ink', t('settings:appearance.ink')],
            ] as const
          ).map(([field, lbl]) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="truncate text-[10.5px] text-muted-foreground">{lbl}</span>
              <input
                type="color"
                value={activeVariant[field]}
                onChange={(e) => updateVariant({ [field]: e.target.value })}
                className="h-7 w-full cursor-pointer rounded border border-border bg-background p-0.5"
              />
            </label>
          ))}
        </div>

        {/* Frame Style */}
        <div>
          <div className="mb-1 font-medium text-muted-foreground">{t('settings:appearance.frameStyle')}</div>
          <div className="grid grid-cols-3 gap-1">
            {FRAME_STYLES.map((fs) => (
              <button
                key={fs}
                type="button"
                onClick={() => updateVariant({ frameStyle: fs as ThemeFrameStyle })}
                className={cn(
                  'rounded border px-1.5 py-1 text-center text-[11px]',
                  (activeVariant.frameStyle ?? 'paper') === fs
                    ? 'border-[var(--brand)] bg-[var(--brand)]/12 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`settings:appearance.frameOptions.${fs}`).split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Message Flow Style */}
        <div>
          <div className="mb-1 font-medium text-muted-foreground">{t('settings:appearance.messageStyle')}</div>
          <div className="grid grid-cols-3 gap-1">
            {MESSAGE_STYLES.map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => updateVariant({ messageStyle: ms as ThemeMessageStyle })}
                className={cn(
                  'rounded border px-1.5 py-1 text-center text-[11px]',
                  (activeVariant.messageStyle ?? 'bubble') === ms
                    ? 'border-[var(--brand)] bg-[var(--brand)]/12 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`settings:appearance.messageOptions.${ms}`).split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Reading Column Width */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-muted-foreground">{t('settings:appearance.contentWidth')}</span>
            <button
              type="button"
              onClick={() => updateVariant({ contentWidth: contentW === 0 ? 840 : 0 })}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10.5px]',
                contentW === 0 ? 'bg-[var(--brand)]/15 font-semibold text-[var(--brand)]' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {contentW === 0 ? '100%' : `${contentW}px`}
            </button>
          </div>
          {contentW !== 0 ? (
            <input
              type="range"
              min={640}
              max={1400}
              step={20}
              value={contentW}
              onChange={(e) => updateVariant({ contentWidth: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          ) : null}
        </div>

        {/* Density & Accent Presence */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10.5px] text-muted-foreground">{t('settings:appearance.spacingDensity')}</div>
            <select
              value={activeVariant.density ?? 'default'}
              onChange={(e) => updateVariant({ density: e.target.value as ThemeDensity })}
              className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px]"
            >
              {THEME_DENSITIES.map((d) => (
                <option key={d} value={d}>
                  {t(`settings:appearance.densityOptions.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] text-muted-foreground">{t('settings:appearance.accentPresence')}</div>
            <select
              value={activeVariant.accentPresence ?? 'subtle'}
              onChange={(e) => updateVariant({ accentPresence: e.target.value as ThemeAccentPresence })}
              className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px]"
            >
              {ACCENT_PRESENCES.map((ap) => (
                <option key={ap} value={ap}>
                  {t(`settings:appearance.accentOptions.${ap}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Surface Optical Material */}
        <div>
          <div className="mb-1 font-medium text-muted-foreground">{t('settings:appearance.surfaceMaterial')}</div>
          <select
            value={activeVariant.surfaceMaterial ?? 'solid'}
            onChange={(e) => updateVariant({ surfaceMaterial: e.target.value as ThemeSurfaceMaterial })}
            className="h-7 w-full rounded border border-border bg-background px-2 text-[11.5px]"
          >
            {SURFACE_MATERIALS.map((sm) => (
              <option key={sm} value={sm}>
                {t(`settings:appearance.materialOptions.${sm}`)}
              </option>
            ))}
          </select>

          {(activeVariant.surfaceMaterial === 'liquid-glass' || activeVariant.surfaceMaterial === 'frosted') ? (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/60 bg-[var(--bg-elevated)]/30 p-2.5">
              {activeVariant.surfaceMaterial === 'liquid-glass' ? (
                <label className="flex flex-col gap-0.5">
                  <div className="flex justify-between text-[10.5px]">
                    <span className="text-muted-foreground">{t('settings:appearance.glassRefraction')}</span>
                    <span className="font-mono">{activeVariant.glassRefraction ?? 24}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={48}
                    step={2}
                    value={activeVariant.glassRefraction ?? 24}
                    onChange={(e) => updateVariant({ glassRefraction: Number(e.target.value) })}
                    className="w-full accent-[var(--brand)]"
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-0.5">
                <div className="flex justify-between text-[10.5px]">
                  <span className="text-muted-foreground">{t('settings:appearance.glassFrost')}</span>
                  <span className="font-mono">{activeVariant.glassFrost ?? 10}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={28}
                  step={1}
                  value={activeVariant.glassFrost ?? 10}
                  onChange={(e) => updateVariant({ glassFrost: Number(e.target.value) })}
                  className="w-full accent-[var(--brand)]"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <div className="flex justify-between text-[10.5px]">
                  <span className="text-muted-foreground">{t('settings:appearance.glassTintAlpha')}</span>
                  <span className="font-mono">{Math.round((activeVariant.glassTintAlpha ?? 0.55) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={0.95}
                  step={0.03}
                  value={activeVariant.glassTintAlpha ?? 0.55}
                  onChange={(e) => updateVariant({ glassTintAlpha: Number(e.target.value) })}
                  className="w-full accent-[var(--brand)]"
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* Procedural Backdrop Stage & Code Syntax */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10.5px] text-muted-foreground">{t('settings:appearance.backdropPreset')}</div>
            <select
              value={activeVariant.backdropPreset ?? 'none'}
              onChange={(e) => updateVariant({ backdropPreset: e.target.value as ThemeBackdropPreset })}
              className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px]"
            >
              {BACKDROP_PRESETS.map((bp) => (
                <option key={bp} value={bp}>
                  {t(`settings:appearance.backdropOptions.${bp}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] text-muted-foreground">Shiki</div>
            <select
              value={activeVariant.codeTheme ?? (mode === 'dark' ? 'github-dark' : 'github-light')}
              onChange={(e) => updateVariant({ codeTheme: e.target.value as ShikiThemeId })}
              className="h-7 w-full rounded border border-border bg-background px-1.5 font-mono text-[10.5px]"
            >
              {SHIKI_THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Footer Save / Revert */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3.5 py-2.5">
        <button
          type="button"
          onClick={handleRevert}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          {t('settings:appearance.studioRevert')}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--brand)] px-3 text-[11.5px] font-medium text-white hover:opacity-90"
        >
          <Check className="h-3.5 w-3.5" />
          {t('settings:appearance.studioApplySave')}
        </button>
      </div>
    </aside>,
    document.body,
  )
}
