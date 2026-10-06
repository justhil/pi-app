import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ChevronDown, ChevronRight, Clipboard, Copy, RotateCcw, X } from '@renderer/components/icons'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Switch } from '@renderer/components/ui/switch'
import {
  btnCompact,
  btnOutline,
  btnPrimary,
  inputCls,
  selectCls,
  textareaCls,
} from '@renderer/features/settings/settings-controls'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { cn } from '@renderer/lib/utils'
import { exportThemeString, parseThemeString, type ParsedThemeString } from '@renderer/lib/theme/parse-theme-string'
import { mixColors } from '@renderer/lib/theme/derive-theme'
import { presetsFor, presetVariant, type ThemePreset } from '@renderer/lib/theme/presets'
import {
  normalizeFontName,
  THEME_COLOR_KEYS,
  type ThemeColorOverrides,
  type CustomTheme,
  type ThemeVariant,
  type ThemeVariantKey,
} from '@shared/custom-theme'

const COLOR_RE = /^#[0-9a-f]{6}$/i

type EditableThemeField = Exclude<keyof ThemeVariant, 'preset'>

interface ThemeVariantSectionProps {
  variant: ThemeVariantKey
  theme: CustomTheme
  onChange: (next: CustomTheme) => void
}

interface ColorFieldProps {
  id: string
  value: string
  pickerLabel: string
  textLabel: string
  onChange: (value: string) => void
}

interface FontFieldProps {
  id: string
  value: string | null
  label: string
  placeholder: string
  onChange: (value: string | null) => void
}

interface ThemeImportDialogProps {
  open: boolean
  currentVariant: ThemeVariantKey
  onCancel: () => void
  onConfirm: (parsed: ParsedThemeString) => void
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function themeContrastRatio(foreground: string, background: string): number {
  if (!COLOR_RE.test(foreground) || !COLOR_RE.test(background)) return 21
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function slotWith(theme: CustomTheme, variant: ThemeVariantKey, value?: ThemeVariant): CustomTheme {
  const next = { ...theme }
  if (value) next[variant] = value
  else delete next[variant]
  return next
}

function ColorField({ id, value, pickerLabel, textLabel, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  const commitText = () => {
    const normalized = text.trim().toLowerCase()
    if (COLOR_RE.test(normalized)) onChange(normalized)
    else setText(value)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        id={`${id}-picker`}
        type="color"
        value={value}
        aria-label={pickerLabel}
        onChange={(event) => onChange(event.target.value)}
        className="settings-field-focus h-9 w-11 cursor-pointer rounded-md border border-border bg-background p-1"
      />
      <input
        id={id}
        value={text}
        aria-label={textLabel}
        spellCheck={false}
        maxLength={7}
        className={cn(inputCls, 'w-28 font-mono')}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitText()
          }
        }}
      />
    </div>
  )
}

function FontField({ id, value, label, placeholder, onChange }: FontFieldProps) {
  const [text, setText] = useState(value ?? '')

  useEffect(() => setText(value ?? ''), [value])

  const commit = () => {
    const normalized = normalizeFontName(text)
    setText(normalized ?? '')
    onChange(normalized)
  }

  return (
    <input
      id={id}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      className={cn(inputCls, 'w-full sm:w-64')}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

function ThemeImportDialog({ open, currentVariant, onCancel, onConfirm }: ThemeImportDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedThemeString | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setValue('')
    setError(null)
    setParsed(null)
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      returnFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const preview = () => {
    try {
      const next = parseThemeString(value, currentVariant)
      setParsed(next)
      setError(null)
    } catch (reason) {
      setParsed(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="overlay-panel flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-xl font-semibold text-foreground">
              {t('settings:appearance.importDialogTitle')}
            </h2>
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {t('settings:appearance.importDialogDesc')}
            </p>
          </div>
          <button
            type="button"
            className={btnCompact}
            aria-label={t('settings:appearance.closeDialog')}
            onClick={onCancel}
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="theme-import-value" className="text-sm font-medium text-foreground">
            {t('settings:appearance.importValueLabel')}
          </label>
          <textarea
            id="theme-import-value"
            ref={textareaRef}
            rows={7}
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'theme-import-error' : undefined}
            placeholder={t('settings:appearance.importPlaceholder')}
            className={textareaCls}
            onChange={(event) => {
              setValue(event.target.value)
              setParsed(null)
              setError(null)
            }}
          />
          {error ? (
            <p id="theme-import-error" role="alert" className="text-sm text-destructive">
              {t('settings:appearance.importError', { error })}
            </p>
          ) : null}
        </div>

        {parsed ? (
          <div className="flex flex-col gap-1 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('settings:appearance.importTarget')}</span>
              <span className="font-medium text-foreground">
                {t(`settings:appearance.variant${parsed.targetVariant === 'light' ? 'Light' : 'Dark'}`)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('settings:appearance.importSource')}</span>
              <span className="font-mono text-xs text-foreground">{parsed.sourcePrefix}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('settings:appearance.importIgnored')}</span>
              <span className="font-mono text-xs text-foreground">{parsed.ignoredFieldCount}</span>
            </div>
            {parsed.ignoredFieldCount > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings:appearance.unsupportedFields', { count: parsed.ignoredFieldCount })}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('settings:appearance.singleVariantHint')}
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnCompact} onClick={onCancel}>
            {t('settings:appearance.cancel')}
          </button>
          <button type="button" className={btnOutline} disabled={!value.trim()} onClick={preview}>
            {t('settings:appearance.previewImport')}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!parsed}
            onClick={() => parsed && onConfirm(parsed)}
          >
            {t('settings:appearance.confirmImport')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** A small mock window in the preset's colours: sidebar, paper, a reply line and the accent. */
function PresetCard({ preset, variant, selected, onPick }: { preset: ThemePreset; variant: ThemeVariantKey; selected: boolean; onPick: () => void }) {
  const { t } = useTranslation()
  const v = preset[variant]
  const surface = v?.surface ?? (variant === 'dark' ? '#1f1f1f' : '#ffffff')
  const ink = v?.ink ?? (variant === 'dark' ? '#e6e6e6' : '#12141a')
  const sidebar = v?.colors?.sidebar ?? mixColors(surface, '#000000', 0.06)
  const accent = v?.accent ?? (variant === 'dark' ? '#7583b2' : '#7583b2')
  const bubble = v?.colors?.userBubble ?? mixColors(surface, ink, 0.06)
  const serif = v?.fontDisplay === 'serif'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cn('theme-preset-card group flex flex-col gap-1.5 rounded-lg p-1.5 text-left', selected && 'theme-preset-card--selected')}
    >
      <div className="flex h-[58px] overflow-hidden rounded-md border" style={{ background: surface, borderColor: mixColors(surface, ink, 0.12) }} aria-hidden>
        <div className="w-[26%] shrink-0" style={{ background: sidebar }}>
          <div className="mx-1.5 mt-2 h-1 rounded-full" style={{ background: mixColors(sidebar, ink, 0.25) }} />
          <div className="mx-1.5 mt-1 h-1 w-2/3 rounded-full" style={{ background: mixColors(sidebar, ink, 0.18) }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 pt-2">
          <div className="ml-auto h-2.5 w-1/2 rounded" style={{ background: bubble }} />
          <div className="text-[11px] leading-none" style={{ color: ink, fontFamily: serif ? 'var(--font-serif-base)' : undefined }}>Aa 文</div>
          <div className="h-1 w-4/5 rounded-full" style={{ background: mixColors(surface, ink, 0.22) }} />
          <div className="mt-auto mb-1.5 h-1.5 w-6 rounded-full" style={{ background: accent }} />
        </div>
      </div>
      <span className="truncate px-0.5 text-[12px] text-foreground-secondary group-aria-checked:text-foreground">{t(`settings:appearance.presets.${preset.labelKey}`)}</span>
    </button>
  )
}

/** Colour override that can fall back to the derived value ("Auto"). */
function OptionalColorField({ id, label, value, fallback, onChange }: { id: string; label: string; value?: string; fallback: string; onChange: (value: string | undefined) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <ColorField id={id} value={value} pickerLabel={label} textLabel={`${label} hex`} onChange={onChange} />
      ) : (
        <span className="inline-flex h-9 items-center gap-2 px-1 text-[12.5px] text-foreground-secondary">
          <span className="h-4 w-4 rounded border border-border" style={{ background: fallback }} aria-hidden />
          {t('settings:appearance.auto')}
        </span>
      )}
      <button type="button" className={btnCompact} onClick={() => onChange(value ? undefined : fallback)}>
        {value ? t('settings:appearance.useAuto') : t('settings:appearance.customize')}
      </button>
    </div>
  )
}

function RangeField({ label, value, fallback, min, max, step, format, onChange }: { label: string; value?: number; fallback: number; min: number; max: number; step: number; format: (n: number) => string; onChange: (value: number | undefined) => void }) {
  const { t } = useTranslation()
  const current = value ?? fallback
  return (
    <div className="flex w-full min-w-[14rem] items-center gap-3 sm:w-72">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        aria-label={label}
        value={current}
        className="settings-field-focus min-w-0 flex-1 accent-[var(--brand)]"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className={cn('w-10 text-right font-mono text-[12px]', value === undefined ? 'text-foreground-tertiary' : 'text-foreground')}>{format(current)}</output>
      <button type="button" className={cn('text-[11.5px] text-foreground-tertiary hover:text-foreground', value === undefined && 'invisible')} onClick={() => onChange(undefined)} aria-label={`${label}: ${t('settings:appearance.useAuto')}`}>
        <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <div className="theme-group-heading px-[var(--settings-row-px,16px)] pb-1 pt-4 text-[11.5px] text-foreground-tertiary first:pt-3">{children}</div>
}

const COLOR_LABEL: Record<(typeof THEME_COLOR_KEYS)[number], string> = {
  sidebar: 'colorSidebar',
  chat: 'colorChat',
  userBubble: 'colorUserBubble',
  codeBg: 'colorCode',
  border: 'colorBorder',
}

function ThemeVariantSection({ variant, theme, onChange }: ThemeVariantSectionProps) {
  const { t } = useTranslation()
  const configured = theme[variant]
  const [importOpen, setImportOpen] = useState(false)
  const contrastRatio = configured ? themeContrastRatio(configured.ink, configured.surface) : 21
  const presets = useMemo(() => presetsFor(variant), [variant])
  const selectedPreset = configured ? configured.preset : 'default'

  const changeField = <K extends EditableThemeField>(field: K, value: ThemeVariant[K] | undefined) => {
    if (!configured) return
    const next = { ...configured, preset: null } as ThemeVariant
    if (value === undefined) delete next[field]
    else next[field] = value as ThemeVariant[K]
    onChange(slotWith(theme, variant, next))
  }

  const changeColor = (key: keyof ThemeColorOverrides, value: string | undefined) => {
    if (!configured) return
    const colors = { ...(configured.colors ?? {}) }
    if (value) colors[key] = value
    else delete colors[key]
    changeField('colors', Object.keys(colors).length ? colors : undefined)
  }

  const handlePreset = (id: string) => {
    if (id === 'default') {
      onChange(slotWith(theme, variant))
      return
    }
    const preset = presetVariant(id, variant)
    if (preset) onChange(slotWith(theme, variant, preset))
  }

  const copyTheme = async () => {
    if (!configured) return
    try {
      await navigator.clipboard.writeText(exportThemeString(configured, variant))
      toast.success(t('settings:appearance.copySuccess'))
    } catch {
      toast.error(t('settings:appearance.copyFailed'))
    }
  }

  // What "Auto" resolves to, shown as the swatch next to it.
  const derived = configured
    ? {
        sidebar: mixColors(configured.surface, '#000000', 0.045),
        chat: configured.surface,
        userBubble: mixColors(configured.surface, configured.ink, 0.035),
        codeBg: mixColors(configured.surface, configured.ink, 0.03),
        border: mixColors(configured.surface, configured.ink, 0.11),
      }
    : null
  const displayMode = !configured?.fontDisplay ? 'ui' : configured.fontDisplay === 'serif' ? 'serif' : 'custom'

  return (
    <>
      <SettingsSection
        title={t(`settings:appearance.variant${variant === 'light' ? 'Light' : 'Dark'}`)}
        description={t(`settings:appearance.variant${variant === 'light' ? 'LightDesc' : 'DarkDesc'}`)}
        action={
          <div className="flex items-center gap-1">
            <button type="button" className={cn(btnCompact, 'min-h-9')} onClick={() => setImportOpen(true)}>
              <Clipboard className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {t('settings:appearance.importTheme')}
            </button>
            <button
              type="button"
              className={cn(btnCompact, 'min-h-9')}
              disabled={!configured}
              onClick={() => void copyTheme()}
            >
              <Copy className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {t('settings:appearance.copyTheme')}
            </button>
          </div>
        }
      >
        <div className="settings-row">
          <div role="radiogroup" aria-label={t('settings:appearance.preset')} className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((p) => (
              <PresetCard key={p.id} preset={p} variant={variant} selected={selectedPreset === p.id} onPick={() => handlePreset(p.id)} />
            ))}
          </div>
        </div>
        {configured && !configured.preset ? (
          <div className="settings-row text-[12px] text-foreground-secondary">{t('settings:appearance.presetCustomHint')}</div>
        ) : null}

        {configured && derived ? (
          <>
            <GroupHeading>{t('settings:appearance.groupColors')}</GroupHeading>
            <SettingRow label={t('settings:appearance.accent')} description={t('settings:appearance.accentDesc')}>
              <ColorField
                id={`${variant}-theme-accent`}
                value={configured.accent}
                pickerLabel={t('settings:appearance.accentPicker')}
                textLabel={t('settings:appearance.accentHex')}
                onChange={(value) => changeField('accent', value)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.surface')} description={t('settings:appearance.surfaceDesc')}>
              <ColorField
                id={`${variant}-theme-surface`}
                value={configured.surface}
                pickerLabel={t('settings:appearance.surfacePicker')}
                textLabel={t('settings:appearance.surfaceHex')}
                onChange={(value) => changeField('surface', value)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.ink')} description={t('settings:appearance.inkDesc')}>
              <ColorField
                id={`${variant}-theme-ink`}
                value={configured.ink}
                pickerLabel={t('settings:appearance.inkPicker')}
                textLabel={t('settings:appearance.inkHex')}
                onChange={(value) => changeField('ink', value)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.contrast')} description={t('settings:appearance.contrastDesc')}>
              <div className="flex w-full min-w-[14rem] items-center gap-3 sm:w-64">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  aria-label={t('settings:appearance.contrast')}
                  value={configured.contrast}
                  className="settings-field-focus min-w-0 flex-1 accent-[var(--brand)]"
                  onChange={(event) => changeField('contrast', Number(event.target.value))}
                />
                <output className="w-8 text-right font-mono text-sm text-foreground">{configured.contrast}</output>
              </div>
            </SettingRow>
            {contrastRatio < 4.5 ? (
              <div role="status" className="flex items-start gap-2 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <span>
                  {t('settings:appearance.contrastWarning', { ratio: contrastRatio.toFixed(2) })}
                </span>
              </div>
            ) : null}
            {THEME_COLOR_KEYS.map((key) => (
              <SettingRow key={key} label={t(`settings:appearance.${COLOR_LABEL[key]}`)}>
                <OptionalColorField
                  id={`${variant}-theme-${key}`}
                  label={t(`settings:appearance.${COLOR_LABEL[key]}`)}
                  value={configured.colors?.[key]}
                  fallback={derived[key]}
                  onChange={(value) => changeColor(key, value)}
                />
              </SettingRow>
            ))}

            <GroupHeading>{t('settings:appearance.groupType')}</GroupHeading>
            <SettingRow label={t('settings:appearance.fontUi')} description={t('settings:appearance.fontUiDesc')}>
              <FontField
                id={`${variant}-theme-font-ui`}
                value={configured.fontUi}
                label={t('settings:appearance.fontUi')}
                placeholder={t('settings:appearance.fontUiPlaceholder')}
                onChange={(value) => changeField('fontUi', value)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.fontCode')} description={t('settings:appearance.fontCodeDesc')}>
              <FontField
                id={`${variant}-theme-font-code`}
                value={configured.fontCode}
                label={t('settings:appearance.fontCode')}
                placeholder={t('settings:appearance.fontCodePlaceholder')}
                onChange={(value) => changeField('fontCode', value)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.fontDisplay')} description={t('settings:appearance.fontDisplayDesc')}>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t('settings:appearance.fontDisplay')}
                  value={displayMode}
                  className={selectCls}
                  onChange={(event) => {
                    const mode = event.target.value
                    changeField('fontDisplay', mode === 'ui' ? undefined : mode === 'serif' ? 'serif' : configured.fontUi ?? 'Georgia')
                  }}
                >
                  <option value="ui">{t('settings:appearance.fontDisplayUi')}</option>
                  <option value="serif">{t('settings:appearance.fontDisplaySerif')}</option>
                  <option value="custom">{t('settings:appearance.fontDisplayCustom')}</option>
                </select>
                {displayMode === 'custom' ? (
                  <FontField
                    id={`${variant}-theme-font-display`}
                    value={configured.fontDisplay ?? null}
                    label={t('settings:appearance.fontDisplay')}
                    placeholder="Georgia"
                    onChange={(value) => changeField('fontDisplay', value ?? undefined)}
                  />
                ) : null}
              </div>
            </SettingRow>
            <SettingRow label={t('settings:appearance.proseFont')} description={t('settings:appearance.proseFontDesc')}>
              <Switch
                aria-label={t('settings:appearance.proseFont')}
                checked={configured.proseFont === 'display'}
                disabled={!configured.fontDisplay}
                onCheckedChange={(value) => changeField('proseFont', value ? 'display' : undefined)}
              />
            </SettingRow>
            <SettingRow label={t('settings:appearance.chatFontSize')}>
              <RangeField label={t('settings:appearance.chatFontSize')} value={configured.chatFontSize} fallback={15} min={12} max={18} step={1} format={(n) => `${n}px`} onChange={(v) => changeField('chatFontSize', v)} />
            </SettingRow>
            <SettingRow label={t('settings:appearance.chatLineHeight')}>
              <RangeField label={t('settings:appearance.chatLineHeight')} value={configured.chatLineHeight} fallback={1.65} min={1.3} max={2} step={0.05} format={(n) => n.toFixed(2)} onChange={(v) => changeField('chatLineHeight', v)} />
            </SettingRow>

            <GroupHeading>{t('settings:appearance.groupShape')}</GroupHeading>
            <SettingRow label={t('settings:appearance.radius')} description={t('settings:appearance.radiusDesc')}>
              <RangeField label={t('settings:appearance.radius')} value={configured.radius} fallback={10} min={0} max={16} step={1} format={(n) => `${n}px`} onChange={(v) => changeField('radius', v)} />
            </SettingRow>
            <SettingRow label={t('settings:appearance.shadow')} description={t('settings:appearance.shadowDesc')}>
              <RangeField label={t('settings:appearance.shadow')} value={configured.shadow} fallback={50} min={0} max={100} step={5} format={(n) => String(n)} onChange={(v) => changeField('shadow', v)} />
            </SettingRow>
            <SettingRow
              label={t('settings:appearance.translucentSidebar')}
              description={t('settings:appearance.translucentSidebarDesc')}
            >
              <Switch
                aria-label={t('settings:appearance.translucentSidebar')}
                checked={configured.translucentSidebar}
                onCheckedChange={(value) => changeField('translucentSidebar', value)}
              />
            </SettingRow>
            <SettingRow
              label={t('settings:appearance.restoreDefault')}
              description={t('settings:appearance.restoreDefaultDesc')}
            >
              <button type="button" className={btnCompact} onClick={() => onChange(slotWith(theme, variant))}>
                <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {t('settings:appearance.restoreDefault')}
              </button>
            </SettingRow>
          </>
        ) : (
          <div className="settings-row text-[12.5px] text-muted-foreground">{t('settings:appearance.defaultSlotHint')}</div>
        )}
      </SettingsSection>

      <ThemeImportDialog
        open={importOpen}
        currentVariant={variant}
        onCancel={() => setImportOpen(false)}
        onConfirm={(parsed) => {
          onChange(slotWith(theme, parsed.targetVariant, parsed.themeVariant))
          setImportOpen(false)
          if (parsed.ignoredFieldCount > 0) {
            toast.warning(
              t('settings:appearance.unsupportedFields', { count: parsed.ignoredFieldCount }),
            )
          } else {
            toast.success(t('settings:appearance.importSuccess'))
          }
        }}
      />
    </>
  )
}

/** Variables the custom CSS can set (click to insert a declaration). */
const CSS_VARIABLES: { name: string; key: string }[] = [
  { name: '--bg-base', key: 'varSurface' },
  { name: '--chat-bg', key: 'varChat' },
  { name: '--surface-sidebar', key: 'varSidebar' },
  { name: '--message-user-bg', key: 'varUserBubble' },
  { name: '--code-bg', key: 'varCode' },
  { name: '--text-primary', key: 'varText' },
  { name: '--text-secondary', key: 'varTextSecondary' },
  { name: '--border-base', key: 'varBorder' },
  { name: '--brand', key: 'varAccent' },
  { name: '--font-sans', key: 'varFontUi' },
  { name: '--font-mono', key: 'varFontCode' },
  { name: '--font-display', key: 'varFontDisplay' },
  { name: '--prose-font', key: 'varProse' },
  { name: '--chat-font-size', key: 'varChatSize' },
  { name: '--chat-line-height', key: 'varChatLine' },
  { name: '--radius', key: 'varRadius' },
  { name: '--main-chat-surface-radius', key: 'varPaperRadius' },
  { name: '--main-chat-surface-shadow', key: 'varPaperShadow' },
  { name: '--diff-added', key: 'varDiffAdded' },
  { name: '--diff-removed', key: 'varDiffRemoved' },
]

export function AppearanceThemeEditor() {
  const { t } = useTranslation()
  const { draft, setCustomTheme, setCustomCssOverride } = useSettingsDraft()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <ThemeVariantSection variant="light" theme={draft.customTheme} onChange={setCustomTheme} />
      <ThemeVariantSection variant="dark" theme={draft.customTheme} onChange={setCustomTheme} />

      <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p>{t('settings:appearance.shikiHint')}</p>
          <p>{t('settings:appearance.unsupportedHint')}</p>
        </div>
      </div>

      <SettingsSection
        title={t('settings:appearance.advanced')}
        description={t('settings:appearance.advancedDesc')}
        action={
          <button
            type="button"
            className={btnCompact}
            aria-expanded={advancedOpen}
            aria-controls="appearance-custom-css"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? (
              <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            )}
            {advancedOpen ? t('settings:appearance.collapse') : t('settings:appearance.expand')}
          </button>
        }
      >
        {advancedOpen ? (
          <div id="appearance-custom-css" className="flex flex-col gap-3 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <label htmlFor="appearance-custom-css-value" className="text-base font-medium text-foreground">
                  {t('settings:appearance.customCss')}
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {t('settings:appearance.customCssDesc')}
                </p>
              </div>
              <Switch
                aria-label={t('settings:appearance.customCssEnabled')}
                checked={draft.customCssOverride.enabled}
                onCheckedChange={(enabled) =>
                  setCustomCssOverride({ ...draft.customCssOverride, enabled })
                }
              />
            </div>
            <textarea
              id="appearance-custom-css-value"
              rows={10}
              spellCheck={false}
              value={draft.customCssOverride.css}
              placeholder={t('settings:appearance.customCssPlaceholder')}
              className={textareaCls}
              onChange={(event) =>
                setCustomCssOverride({ ...draft.customCssOverride, css: event.target.value })
              }
            />
            <details className="theme-var-reference text-[12px]">
              <summary className="cursor-pointer select-none text-foreground-secondary">{t('settings:appearance.varReference')}</summary>
              <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {CSS_VARIABLES.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className="flex min-w-0 items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                    title={t('settings:appearance.varInsert')}
                    onClick={() => {
                      const css = draft.customCssOverride.css
                      const line = `:root { ${v.name}: ; }`
                      setCustomCssOverride({ ...draft.customCssOverride, css: css ? `${css.replace(/\s*$/, '')}\n${line}` : line })
                    }}
                  >
                    <code className="shrink-0 font-mono text-[11.5px] text-foreground">{v.name}</code>
                    <span className="truncate text-foreground-tertiary">{t(`settings:appearance.${v.key}`)}</span>
                  </button>
                ))}
              </div>
            </details>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
                {t('settings:appearance.safeModeHint')}
              </p>
              <button
                type="button"
                className={btnCompact}
                disabled={!draft.customCssOverride.css && !draft.customCssOverride.enabled}
                onClick={() => setCustomCssOverride({ enabled: false, css: '' })}
              >
                {t('settings:appearance.clearCustomCss')}
              </button>
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </div>
  )
}
