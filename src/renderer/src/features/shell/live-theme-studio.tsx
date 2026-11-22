import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ACCENT_PRESENCES,
  BACKDROP_PRESETS,
  CUSTOM_THEME_CSS_CACHE_KEY,
  DEFAULT_CUSTOM_CSS_OVERRIDE,
  FRAME_STYLES,
  MESSAGE_STYLES,
  normalizeCustomCssOverride,
  normalizeCustomTheme,
  SHIKI_THEME_IDS,
  SURFACE_MATERIALS,
  THEME_DENSITIES,
  type CustomCssOverride,
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
import {
  DEFAULT_TIMELINE_USER_MESSAGE_STYLE,
  normalizeTimelineUserMessageStyle,
  type TimelineUserMessageStyle,
} from '@shared/timeline-settings'
import {
  DEFAULT_UI_CUSTOMIZATION,
  normalizeUiCustomization,
  type UiCustomization,
} from '@shared/ui-customization'
import { ipcClient } from '@renderer/lib/ipc-client'
import { applyCustomTheme } from '@renderer/lib/theme/inject-theme'
import { injectCustomCssOverride } from '@renderer/lib/theme/inject-custom-css'
import { generateThemeCss } from '@renderer/lib/theme/generate-theme-css'
import {
  applyUiCustomizationToDocument,
  highlightPiSlot,
} from '@renderer/lib/theme/apply-ui-customization'
import { applyUserMessageStyleToDocument } from '@renderer/features/settings/settings-draft'
import {
  WorkbenchComposerControls,
  WorkbenchCssInspectorControls,
  WorkbenchReadingControls,
} from '@renderer/features/settings/workbench-customizer-controls'
import { presetsFor, presetVariant } from '@renderer/lib/theme/presets'
import { Switch } from '@renderer/components/ui/switch'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { Check, GripVertical, RotateCcw, Sparkles, X } from '@renderer/components/icons'

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

type StudioTab = 'workbench' | 'theme' | 'css'

interface StudioSnapshot {
  theme: CustomTheme
  ui: UiCustomization
  userMsgStyle: TimelineUserMessageStyle
  customCss: CustomCssOverride
}

/**
 * Draggable floating customize studio over the live conversation & composer view.
 * Combines intuitive drag-reorder / toggle / slider controls with live element-picker CSS editing.
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
  const panelRef = useRef<HTMLElement>(null)
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [tab, setTab] = useState<StudioTab>('workbench')

  const [snapshot, setSnapshot] = useState<StudioSnapshot>({
    theme: {},
    ui: DEFAULT_UI_CUSTOMIZATION,
    userMsgStyle: DEFAULT_TIMELINE_USER_MESSAGE_STYLE,
    customCss: DEFAULT_CUSTOM_CSS_OVERRIDE,
  })
  const [workingTheme, setWorkingTheme] = useState<CustomTheme>({})
  const [workingUi, setWorkingUi] = useState<UiCustomization>(DEFAULT_UI_CUSTOMIZATION)
  const [workingUserMsgStyle, setWorkingUserMsgStyle] = useState<TimelineUserMessageStyle>(
    DEFAULT_TIMELINE_USER_MESSAGE_STYLE,
  )
  const [workingCss, setWorkingCss] = useState<CustomCssOverride>(DEFAULT_CUSTOM_CSS_OVERRIDE)

  const [mode, setMode] = useState<ThemeVariantKey>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    if (!open) {
      highlightPiSlot(null)
      return
    }
    let live = true
    const init = async () => {
      const res = await ipcClient.invoke('settings.get', {}).catch(() => ({ settings: {} }))
      if (!live) return
      const s = (res?.settings ?? {}) as Record<string, unknown>
      const diskTheme = normalizeCustomTheme(s.customTheme)
      const diskUi = normalizeUiCustomization(s.uiCustomization)
      const diskUserMsgStyle = normalizeTimelineUserMessageStyle(s.timelineUserMessageStyle)
      const diskCss = normalizeCustomCssOverride(s.customCssOverride)
      const startTheme = initialTheme && (initialTheme.light || initialTheme.dark) ? initialTheme : diskTheme

      // Carry over any live in-memory preview from Settings if already modified
      const storeState = useUIStore.getState()
      const startUi = storeState.uiCustomization ?? diskUi
      const startUserMsgStyle = storeState.timelineUserMessageStyle ?? diskUserMsgStyle

      setSnapshot({
        theme: diskTheme,
        ui: diskUi,
        userMsgStyle: diskUserMsgStyle,
        customCss: diskCss,
      })
      setWorkingTheme(startTheme)
      setWorkingUi(startUi)
      setWorkingUserMsgStyle(startUserMsgStyle)
      setWorkingCss(diskCss)

      applyUiCustomizationToDocument(startUi)
      applyUserMessageStyleToDocument(startUserMsgStyle)
      applyCustomTheme(startTheme)
      injectCustomCssOverride(diskCss)
      setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    }
    void init()
    return () => {
      live = false
      highlightPiSlot(null)
    }
  }, [open, initialTheme])

  if (!open) return null

  const activeVariant: ThemeVariant = workingTheme[mode] ?? DEFAULT_FALLBACK[mode]

  const updateVariant = (patch: Partial<ThemeVariant>) => {
    const nextVariant: ThemeVariant = {
      ...activeVariant,
      preset: patch.preset !== undefined ? patch.preset : null,
      ...patch,
    }
    const nextTheme: CustomTheme = { ...workingTheme, [mode]: nextVariant }
    setWorkingTheme(nextTheme)
    applyCustomTheme(nextTheme)
  }

  const updateUi = (patch: Partial<UiCustomization>) => {
    const next = normalizeUiCustomization({ ...workingUi, ...patch })
    setWorkingUi(next)
    useUIStore.getState().setUiCustomization(next)
    applyUiCustomizationToDocument(next)
  }

  const updateUserMsgStyle = (style: TimelineUserMessageStyle) => {
    const normalized = normalizeTimelineUserMessageStyle(style)
    setWorkingUserMsgStyle(normalized)
    useUIStore.getState().setTimelineUserMessageStyle(normalized)
    applyUserMessageStyleToDocument(normalized)
  }

  const updateCustomCss = (nextCss: CustomCssOverride) => {
    const normalized = normalizeCustomCssOverride(nextCss)
    setWorkingCss(normalized)
    injectCustomCssOverride(normalized)
  }

  const switchMode = (target: ThemeVariantKey) => {
    setMode(target)
    document.documentElement.classList.toggle('dark', target === 'dark')
    useUIStore.getState().setTheme(target)
    void ipcClient.invoke('settings.set', { key: 'theme', value: target }).catch(() => {})
    applyCustomTheme(workingTheme)
  }

  const pickPreset = (id: string) => {
    if (id === 'default') {
      const next = { ...workingTheme }
      delete next[mode]
      setWorkingTheme(next)
      applyCustomTheme(next)
      return
    }
    const pv = presetVariant(id, mode)
    if (pv) {
      const next = { ...workingTheme, [mode]: pv }
      setWorkingTheme(next)
      applyCustomTheme(next)
    }
  }

  const handleSave = async () => {
    const themeVal = workingTheme.light || workingTheme.dark ? workingTheme : null
    await Promise.all([
      ipcClient.invoke('settings.set', { key: 'customTheme', value: themeVal }),
      ipcClient.invoke('settings.set', { key: 'uiCustomization', value: workingUi }),
      ipcClient.invoke('settings.set', { key: 'timelineUserMessageStyle', value: workingUserMsgStyle }),
      ipcClient.invoke('settings.set', { key: 'customCssOverride', value: workingCss }),
    ])
    try {
      const css = generateThemeCss(workingTheme)
      if (css) localStorage.setItem(CUSTOM_THEME_CSS_CACHE_KEY, css)
      else localStorage.removeItem(CUSTOM_THEME_CSS_CACHE_KEY)
    } catch {
      /* ignore */
    }
    setSnapshot({
      theme: workingTheme,
      ui: workingUi,
      userMsgStyle: workingUserMsgStyle,
      customCss: workingCss,
    })
    highlightPiSlot(null)
    toast.success(t('settings:appearance.studioSaved'))
    onClose()
  }

  const handleRevert = () => {
    setWorkingTheme(snapshot.theme)
    setWorkingUi(snapshot.ui)
    setWorkingUserMsgStyle(snapshot.userMsgStyle)
    setWorkingCss(snapshot.customCss)
    useUIStore.getState().setUiCustomization(snapshot.ui)
    useUIStore.getState().setTimelineUserMessageStyle(snapshot.userMsgStyle)
    applyUiCustomizationToDocument(snapshot.ui)
    applyUserMessageStyleToDocument(snapshot.userMsgStyle)
    applyCustomTheme(snapshot.theme)
    injectCustomCssOverride(snapshot.customCss)
    highlightPiSlot(null)
  }

  const handleHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    }
  }

  const handleHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const maxLeft = -(window.innerWidth - 380)
    const clampedX = Math.min(8, Math.max(maxLeft, drag.origX + dx))
    const clampedY = Math.min(window.innerHeight - 160, Math.max(-36, drag.origY + dy))
    setOffset({ x: clampedX, y: clampedY })
  }

  const handleHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return
    dragStateRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return createPortal(
    <aside
      ref={panelRef}
      aria-label={t('settings:appearance.studioTitle')}
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
      }}
      className="live-theme-studio fixed right-3 top-12 bottom-9 z-[120] flex w-[376px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-[var(--bg-base)]/95 text-foreground shadow-2xl backdrop-blur-md"
    >
      {/* Draggable Header */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        onDoubleClick={() => setOffset({ x: 0, y: 0 })}
        title={t('settings:appearance.workbench.dragWindowHint')}
        className="flex cursor-move select-none items-center justify-between border-b border-border/60 px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          <span className="truncate">{t('settings:appearance.studioTitle')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="settings-segmented flex h-6 gap-0.5 rounded p-0.5 text-[11px]">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'light'}
              onClick={() => switchMode('light')}
              className="settings-segmented-item rounded-[3px] px-2"
            >
              {t('settings:appearance.themeLight')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'dark'}
              onClick={() => switchMode('dark')}
              className="settings-segmented-item rounded-[3px] px-2"
            >
              {t('settings:appearance.themeDark')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              highlightPiSlot(null)
              onClose()
            }}
            aria-label={t('common:close')}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-3 gap-1 border-b border-border/55 bg-[var(--bg-1)]/45 px-2.5 py-1.5 text-[11.5px]">
        {(['workbench', 'theme', 'css'] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            onClick={() => {
              highlightPiSlot(null)
              setTab(tabKey)
            }}
            className={cn(
              'rounded-md py-1 text-center font-medium transition-colors',
              tab === tabKey
                ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`settings:appearance.workbench.tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      {/* Scrollable Body */}
      <div className="studio-thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3 text-[11.5px]">
        {tab === 'workbench' && (
          <>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {t('settings:appearance.workbench.readingTypography')}
              </div>
              <WorkbenchReadingControls
                compact
                userMessageStyle={workingUserMsgStyle}
                onUserMessageStyleChange={updateUserMsgStyle}
                ui={workingUi}
                onUiChange={updateUi}
              />
            </div>

            <div className="border-t border-border/55 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {t('settings:appearance.workbench.composerSectionTitle')}
              </div>
              <WorkbenchComposerControls compact ui={workingUi} onUiChange={updateUi} />
            </div>
          </>
        )}

        {tab === 'theme' && (
          <>
            <div>
              <div className="mb-1.5 font-medium text-muted-foreground">{t('settings:appearance.preset')}</div>
              <div className="flex flex-wrap gap-1">
                {presetsFor(mode).map((p) => {
                  const active = (workingTheme[mode]?.preset ?? 'default') === p.id
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
                <div className="mb-1 text-[10.5px] text-muted-foreground">{t('settings:appearance.codeTheme')}</div>
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
          </>
        )}

        {tab === 'css' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-foreground">
                {t('settings:appearance.customCss')}
              </span>
              <Switch
                checked={workingCss.enabled}
                aria-label={t('settings:appearance.customCssEnabled')}
                onCheckedChange={(enabled) => updateCustomCss({ ...workingCss, enabled })}
              />
            </div>

            <WorkbenchCssInspectorControls
              compact
              enableElementPicker
              customCss={workingCss}
              onCustomCssChange={updateCustomCss}
            />

            <textarea
              rows={9}
              spellCheck={false}
              value={workingCss.css}
              placeholder={t('settings:appearance.customCssPlaceholder')}
              onChange={(e) => updateCustomCss({ ...workingCss, enabled: true, css: e.target.value })}
              className="w-full rounded-lg border border-border bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground outline-none focus:border-[var(--brand)]"
            />
          </>
        )}
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
