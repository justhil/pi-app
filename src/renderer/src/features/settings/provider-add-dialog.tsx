import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Eye, EyeOff, Plus, Search, X } from '@renderer/components/icons'
import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import {
  PROVIDER_PRESETS,
  allocateProviderKey,
  clonePresetConfig,
  isBuiltInSdkProviderId,
  presetLabel,
  validateProviderKey,
  type ProviderPreset,
  type ProviderPresetCategory,
} from './model-provider-presets'
import { API_OPTS, btnOutline, btnPrimary, inputCls, ProviderAvatar, selectCls } from './models-settings-shared'
import { cn } from '@renderer/lib/utils'

type FilterCategory = 'all' | ProviderPresetCategory

const fieldCls = 'settings-field h-[32px] py-0 text-[12.5px]'

/**
 * Clean, zero-pollution "Add Channel / Provider" modal:
 * - Lets user explicitly name the Provider ID (e.g. `cpa`, `newapi`, `my-relay`) + optional Display Name
 * - Starts with 0 models (never stuffs unrequested starterModels)
 * - Detects collision with built-in Pi SDK provider IDs (`openai`, `anthropic`, `google`, `openrouter`...)
 *   and offers 1-click switch to an isolated ID so built-in default models never pollute the picker
 */
export function ProviderAddDialog({
  open,
  existingProviders,
  runtimeSdkProviderIds,
  onConfirm,
  onClose,
}: {
  open: boolean
  existingProviders: Record<string, PiModelsProviderConfig>
  runtimeSdkProviderIds?: string[]
  onConfirm: (key: string, config: PiModelsProviderConfig) => void
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(PROVIDER_PRESETS[0])
  const [category, setCategory] = useState<FilterCategory>('all')
  const [presetSearch, setPresetSearch] = useState('')
  const [providerKey, setProviderKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [api, setApi] = useState<NonNullable<PiModelsProviderConfig['api']>>('openai-responses')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [touchedKey, setTouchedKey] = useState(false)
  const keyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const initial = PROVIDER_PRESETS[0]
    setSelectedPreset(initial)
    setCategory('all')
    setPresetSearch('')
    setProviderKey('')
    setDisplayName('')
    setApi(initial.config.api || 'openai-responses')
    setBaseUrl(initial.config.baseUrl || '')
    setApiKey(initial.config.apiKey || '')
    setShowKey(false)
    setTouchedKey(false)
    const timer = window.setTimeout(() => keyInputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filteredPresets = useMemo(() => {
    const q = presetSearch.trim().toLowerCase()
    return PROVIDER_PRESETS.filter((p) => {
      if (category !== 'all' && p.category !== category) return false
      if (!q) return true
      const hay = [
        p.id,
        p.defaultKey,
        presetLabel(p, t),
        p.config.baseUrl || '',
        ...(p.aliases || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [category, presetSearch, t])

  if (!open || typeof document === 'undefined') return null

  const applyTemplate = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setApi(preset.config.api || 'openai-completions')
    setBaseUrl(preset.config.baseUrl || '')
    setApiKey(preset.config.apiKey || '')
    if (!touchedKey) {
      if (preset.id === 'custom-openai') {
        setProviderKey('')
      } else {
        setProviderKey(allocateProviderKey(existingProviders, preset.defaultKey))
      }
    }
  }

  const keyValidation = validateProviderKey(providerKey, existingProviders)
  const collidesBuiltIn =
    keyValidation.ok && isBuiltInSdkProviderId(keyValidation.key, runtimeSdkProviderIds)
  const suggestedIsolatedKey = collidesBuiltIn
    ? allocateProviderKey(existingProviders, `${keyValidation.key}-custom`)
    : ''
  const missingBaseUrl = !baseUrl.trim()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyValidation.ok || missingBaseUrl) return
    const skeleton = clonePresetConfig(selectedPreset)
    const finalConfig: PiModelsProviderConfig = {
      ...skeleton,
      api,
      baseUrl: baseUrl.trim(),
      ...(displayName.trim() ? { name: displayName.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      models: [],
    }
    onConfirm(keyValidation.key, finalConfig)
  }

  const keyErrorText =
    providerKey.trim().length > 0 && !keyValidation.ok
      ? keyValidation.reason === 'duplicate'
        ? t('models.providerKeyDuplicate', { key: providerKey.trim() })
        : t('models.providerKeyInvalid')
      : null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('models.addProviderBtn')}
      className="overlay-backdrop fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="overlay-panel flex max-h-[86vh] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-border/85 bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">{t('models.addDialogTitle')}</h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t('models.addDialogSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('models.close')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="studio-thin-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
          {/* Quick Protocol / Vendor Presets */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium text-foreground-secondary">
                {t('models.presetPickerLabel')}
              </span>
              <div className="flex items-center gap-0.5">
                {(['all', 'relay', 'official', 'local'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                      category === cat
                        ? 'bg-[var(--bg-active)] font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
                    )}
                  >
                    {t(`models.presetCategory.${cat}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                placeholder={t('models.presetSearchPlaceholder')}
                className="h-7 w-full rounded-md border border-border/65 bg-background pl-8 pr-2.5 text-[12px] outline-none focus:border-primary/60"
              />
            </div>

            <div className="studio-thin-scroll flex max-h-[116px] flex-wrap gap-1.5 overflow-y-auto pt-0.5">
              {filteredPresets.map((preset) => {
                const active = selectedPreset.id === preset.id
                const label = presetLabel(preset, t)
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyTemplate(preset)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors',
                      active
                        ? 'border-primary/55 bg-primary/10 font-medium text-foreground'
                        : 'border-border/65 bg-background text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                    )}
                  >
                    <ProviderAvatar preset={preset} label={label} />
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Primary Identity Fields: Channel ID (Key) + Optional Display Name */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11.5px] font-medium text-foreground">
                {t('models.labelProviderKey')} <span className="text-destructive">*</span>
              </label>
              <input
                ref={keyInputRef}
                type="text"
                data-testid="new-provider-key-input"
                value={providerKey}
                onChange={(e) => {
                  setTouchedKey(true)
                  setProviderKey(e.target.value)
                }}
                placeholder={t('models.providerKeyPlaceholder')}
                className={cn(inputCls, fieldCls, 'font-mono text-[12.5px]')}
              />
              {keyErrorText ? (
                <p className="mt-1 text-[11px] text-destructive">{keyErrorText}</p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">{t('models.providerKeyHint')}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11.5px] text-foreground-secondary">
                {t('models.labelDisplayNameOptional')}
              </label>
              <input
                type="text"
                data-testid="new-provider-name-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('models.displayNameOptionalPlaceholder')}
                className={cn(inputCls, fieldCls)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('models.displayNameOptionalHint')}</p>
            </div>
          </div>

          {/* Built-in SDK Provider Collision Protection Banner */}
          {collidesBuiltIn && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-200">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{t('models.sdkCollisionWarning', { key: keyValidation.key })}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTouchedKey(true)
                  setProviderKey(suggestedIsolatedKey)
                }}
                className="shrink-0 rounded-md border border-amber-500/45 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-[var(--bg-hover)]"
              >
                {t('models.useIsolatedKeyBtn', { key: suggestedIsolatedKey })}
              </button>
            </div>
          )}

          {/* Connection Fields */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelApi')}</label>
              <select
                className={cn(selectCls, fieldCls, 'w-full')}
                value={api}
                onChange={(e) => setApi(e.target.value as NonNullable<PiModelsProviderConfig['api']>)}
              >
                {API_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11.5px] text-foreground-secondary">
                {t('models.labelApiKey')}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selectedPreset.apiKeyPlaceholder || 'sk-... / $API_KEY'}
                  className={cn(inputCls, fieldCls, 'pr-8 font-mono text-[12px]')}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? t('models.hideKeyLabel') : t('models.showKeyLabel')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11.5px] font-medium text-foreground">
                {t('models.labelBaseUrl')} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                data-testid="new-provider-baseurl-input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={selectedPreset.baseUrlPlaceholder || 'https://api.example.com/v1'}
                className={cn(inputCls, fieldCls, 'font-mono text-[12px]')}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-[var(--bg-1)]/35 px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground">{t('models.zeroPollutionHint')}</span>
          <div className="flex items-center gap-1.5">
            <button type="button" className={btnOutline} onClick={onClose}>
              {t('models.close')}
            </button>
            <button
              type="submit"
              data-testid="confirm-add-provider-btn"
              disabled={!keyValidation.ok || missingBaseUrl}
              className={cn(btnPrimary, 'disabled:opacity-45')}
            >
              <Plus className="mr-1 inline h-3 w-3" strokeWidth={2} />
              {t('models.confirmCreateProvider')}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
