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
import {
  normalizeFontName,
  type CustomTheme,
  type ThemeVariant,
  type ThemeVariantKey,
} from '@shared/custom-theme'

const VSCODE_PLUS: ThemeVariant = {
  preset: 'vscode-plus',
  accent: '#007acc',
  surface: '#ffffff',
  ink: '#000000',
  contrast: 45,
  fontUi: null,
  fontCode: null,
  translucentSidebar: true,
  diffAdded: '#008000',
  diffRemoved: '#ee0000',
}

const CODEX_DARK: ThemeVariant = {
  preset: 'codex-dark',
  accent: '#339cff',
  surface: '#181818',
  ink: '#ffffff',
  contrast: 60,
  fontUi: null,
  fontCode: null,
  translucentSidebar: false,
}

const COLOR_RE = /^#[0-9a-f]{6}$/i

type EditableThemeField = keyof Pick<
  ThemeVariant,
  'accent' | 'surface' | 'ink' | 'contrast' | 'fontUi' | 'fontCode' | 'translucentSidebar'
>

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

function presetFor(variant: ThemeVariantKey, value: string): ThemeVariant | undefined {
  if (variant === 'light' && value === 'vscode-plus') return { ...VSCODE_PLUS }
  if (variant === 'dark' && value === 'codex-dark') return { ...CODEX_DARK }
  return undefined
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

function ThemeVariantSection({ variant, theme, onChange }: ThemeVariantSectionProps) {
  const { t } = useTranslation()
  const configured = theme[variant]
  const [importOpen, setImportOpen] = useState(false)
  const contrastRatio = configured ? themeContrastRatio(configured.ink, configured.surface) : 21
  const presetValue =
    configured?.preset === 'vscode-plus' || configured?.preset === 'codex-dark'
      ? configured.preset
      : configured
        ? 'custom'
        : 'default'

  const changeField = <K extends EditableThemeField>(field: K, value: ThemeVariant[K]) => {
    if (!configured) return
    onChange(slotWith(theme, variant, { ...configured, [field]: value, preset: null }))
  }

  const handlePreset = (value: string) => {
    if (value === 'default') {
      onChange(slotWith(theme, variant))
      return
    }
    const preset = presetFor(variant, value)
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
        <SettingRow label={t('settings:appearance.preset')} description={t('settings:appearance.presetDesc')}>
          <select
            aria-label={t('settings:appearance.preset')}
            value={presetValue}
            className={selectCls}
            onChange={(event) => handlePreset(event.target.value)}
          >
            <option value="default">{t('settings:appearance.presetDefault')}</option>
            {variant === 'light' ? (
              <option value="vscode-plus">{t('settings:appearance.presetVscodePlus')}</option>
            ) : (
              <option value="codex-dark">{t('settings:appearance.presetCodex')}</option>
            )}
            {configured && !configured.preset ? (
              <option value="custom">{t('settings:appearance.presetCustom')}</option>
            ) : null}
          </select>
        </SettingRow>

        {configured ? (
          <>
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
          <div className="py-3 text-sm text-muted-foreground">{t('settings:appearance.defaultSlotHint')}</div>
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
