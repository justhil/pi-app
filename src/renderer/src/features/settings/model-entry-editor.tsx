import { useState, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, Plus, Sparkles, Trash2 } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { useTranslation } from 'react-i18next'
import { inputCls as settingsInputCls, selectCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'
import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import type { UpstreamCatalogModel } from '@shared/models-dev-catalog'
import { ModelAdvancedFields } from './model-advanced-fields'
import { getIn, hasAdvanced, parseNumberInput, setIn } from './model-advanced'

export type LocalModelEntry = NonNullable<PiModelsProviderConfig['models']>[number]

const fieldCls = cn(settingsInputCls, 'settings-field h-[30px] px-2.5 py-0 text-[12.5px]')
const numCls = cn(fieldCls, 'text-right tabular-nums')
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

const THINKING_LEVEL_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One labelled group of fields inside an expanded model. */
function Group({ title, hint, children, cols = 2 }: { title: string; hint?: string; children: ReactNode; cols?: 2 | 4 }) {
  return (
    <section className="settings-model-group">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-[12px] font-medium text-foreground">{title}</h4>
        {hint ? <span className="truncate text-[11.5px] text-foreground-secondary">{hint}</span> : null}
      </div>
      <div className={cn('grid gap-x-3 gap-y-2.5', cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'sm:grid-cols-2')}>{children}</div>
    </section>
  )
}

function Field({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', span && 'sm:col-span-2')}>
      <span className="text-[11.5px] text-foreground-secondary">{label}</span>
      {children}
    </label>
  )
}

/** Number field that commits on blur: blank clears, invalid text snaps back. */
function NumberField({
  value,
  placeholder,
  label,
  integer,
  onCommit,
}: {
  value: unknown
  placeholder?: string
  label: string
  integer?: boolean
  onCommit: (v: number | undefined) => void
}) {
  const text = typeof value === 'number' ? String(value) : ''
  return (
    <input
      key={text}
      aria-label={label}
      inputMode="decimal"
      className={numCls}
      defaultValue={text}
      placeholder={placeholder}
      onBlur={(e) => {
        const n = parseNumberInput(e.target.value, { integer, min: 0 })
        if (n === null) e.target.value = text
        else if (n !== (typeof value === 'number' ? value : undefined)) onCommit(n)
      }}
    />
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="settings-segmented flex h-[30px] gap-0.5 rounded-md p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className="settings-segmented-item flex-1 rounded-[5px] px-2 text-[12px]"
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

const price = (n: unknown) => (typeof n === 'number' ? `$${Number(n.toFixed(4))}` : '')

function countConfiguredAdvanced(model: LocalModelEntry): number {
  let count = 0
  if (model.api) count += 1
  if (model.cost && Object.values(model.cost).some((v) => typeof v === 'number' && v > 0)) count += 1
  if (model.promptCache && Object.keys(model.promptCache).length > 0) count += 1
  if (model.thinkingLevelMap && Object.keys(model.thinkingLevelMap).length > 0) count += 1
  if (hasAdvanced(model)) count += 1
  return count
}

export function ModelEntryEditor({
  model,
  expanded,
  matchedSpec,
  onToggleExpand,
  onChange,
  onApplySpec,
  onRemove,
}: {
  model: LocalModelEntry
  expanded: boolean
  matchedSpec?: UpstreamCatalogModel | null
  onToggleExpand: () => void
  onChange: (patch: Partial<LocalModelEntry>) => void
  onApplySpec?: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('settings')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const input = Array.isArray(model.input) ? model.input : ['text']
  const hasImage = input.includes('image')
  const cost = (model.cost ?? {}) as Record<string, unknown>
  const advancedCount = countConfiguredAdvanced(model)

  const API_OPTS = [
    { v: '', l: t('models.inheritProvider') },
    { v: 'openai-completions', l: 'openai-completions' },
    { v: 'openai-responses', l: 'openai-responses' },
    { v: 'anthropic-messages', l: 'anthropic-messages' },
    { v: 'google-generative-ai', l: 'google-generative-ai' },
  ]

  const thinkingEntries = Object.entries(model.thinkingLevelMap || {})
  const updateThinkingMap = (next: Record<string, string | null>) =>
    onChange({ thinkingLevelMap: Object.keys(next).length ? next : undefined })
  const setThinkingKey = (oldKey: string, newKey: string) => {
    const map = { ...(model.thinkingLevelMap || {}) }
    if (Object.hasOwn(map, newKey)) return
    const value = map[oldKey]
    delete map[oldKey]
    map[newKey] = value
    updateThinkingMap(map)
  }
  const setThinkingValue = (key: string, value: string) =>
    updateThinkingMap({ ...(model.thinkingLevelMap || {}), [key]: value || null })
  const removeThinkingEntry = (key: string) => {
    const map = { ...(model.thinkingLevelMap || {}) }
    delete map[key]
    updateThinkingMap(map)
  }
  const addThinkingEntry = () => {
    const map = { ...(model.thinkingLevelMap || {}) }
    const available = THINKING_LEVEL_OPTIONS.find((option) => !Object.hasOwn(map, option))
    if (available) updateThinkingMap({ ...map, [available]: available })
  }

  /** pi expects all four prices once `cost` exists; blank ones become 0, all blank removes it. */
  const setCost = (key: (typeof COST_KEYS)[number], v: number | undefined) => {
    const next: Record<string, number> = {}
    for (const k of COST_KEYS) {
      const value = k === key ? v : cost[k]
      if (typeof value === 'number') next[k] = value
    }
    if (Object.keys(next).length === 0) return onChange({ cost: undefined })
    for (const k of COST_KEYS) next[k] ??= 0
    onChange({ cost: { ...cost, ...next } })
  }

  const badges = [
    model.contextWindow != null ? formatK(model.contextWindow) : '',
    model.maxTokens != null ? `↑${formatK(model.maxTokens)}` : '',
    model.reasoning ? t('models.reasoningBadge') : '',
    hasImage ? t('models.imageLabel') : '',
    typeof cost.input === 'number' || typeof cost.output === 'number'
      ? `${price(cost.input)}/${price(cost.output)}`
      : '',
  ].filter(Boolean)

  return (
    <div className="settings-model-entry overflow-hidden rounded-lg border" data-open={expanded}>
      <div className="flex items-center gap-1.5 pl-3 pr-2">
        <button
          type="button"
          className="interactive-row flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
          onClick={onToggleExpand}
        >
          <ChevronRight
            className="settings-chevron h-3 w-3 shrink-0 text-foreground-secondary"
            strokeWidth={2}
            data-open={expanded}
          />
          <span className="truncate font-mono text-[12.5px] font-medium text-foreground" title={model.id}>
            {model.id}
          </span>
          {model.name && model.name !== model.id ? (
            <span className="hidden truncate text-[12px] text-foreground-secondary md:inline">
              {model.name}
            </span>
          ) : null}
          {badges.length > 0 ? (
            <span className="ml-auto hidden shrink-0 items-center gap-1 font-mono text-[10.5px] tabular-nums text-foreground-secondary sm:flex">
              {badges.map((b, i) => (
                <span key={i} className="rounded bg-muted/65 px-1.5 py-px">
                  {b}
                </span>
              ))}
            </span>
          ) : null}
        </button>

        {matchedSpec && onApplySpec ? (
          <button
            type="button"
            className="chrome-icon-btn rounded-md p-1.5 text-foreground-secondary hover:bg-primary/10 hover:text-primary"
            onClick={onApplySpec}
            title={t('models.syncSpecTooltip', { name: matchedSpec.name })}
            aria-label={t('models.syncSpecTooltip', { name: matchedSpec.name })}
          >
            <Sparkles className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}

        <button
          type="button"
          className="chrome-icon-btn rounded-md p-1.5 text-foreground-secondary hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label={t('common:delete')}
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>

      <div className="settings-expand-grid" data-open={expanded}>
        <div className="settings-expand-inner">
          <div className="settings-model-entry-panel space-y-4 border-t px-4 py-3.5">
            {/* Tier 1: Core essentials (clean, compact, immediately scannable) */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[12px] font-medium text-foreground">{t('models.groupBasics')}</h4>
                {matchedSpec && onApplySpec ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                    onClick={onApplySpec}
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{t('models.applyUpstreamSpec', { name: matchedSpec.name })}</span>
                  </button>
                ) : null}
              </div>

              <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                <Field label={t('models.modelIdApi')}>
                  <input className={cn(fieldCls, 'font-mono opacity-80')} value={model.id} readOnly />
                </Field>
                <Field label={t('models.displayName')}>
                  <input
                    className={fieldCls}
                    value={model.name || ''}
                    placeholder={model.id}
                    onChange={(e) => onChange({ name: e.target.value || undefined })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
                <Field label={t('models.inputLabel')}>
                  <Segmented
                    label={t('models.inputLabel')}
                    value={hasImage ? 'image' : 'text'}
                    options={[
                      { v: 'text', l: t('models.inputText') },
                      { v: 'image', l: t('models.inputTextImage') },
                    ]}
                    onChange={(v) => onChange({ input: v === 'image' ? ['text', 'image'] : ['text'] })}
                  />
                </Field>
                <Field label={t('models.reasoningModel')}>
                  <div className="flex h-[30px] items-center">
                    <Switch
                      checked={!!model.reasoning}
                      aria-label={t('models.reasoningModel')}
                      onCheckedChange={(v) => onChange({ reasoning: v || undefined })}
                    />
                  </div>
                </Field>
                <Field label={t('models.contextWindowLabel')}>
                  <NumberField
                    label="contextWindow"
                    integer
                    value={model.contextWindow}
                    placeholder="128000"
                    onCommit={(v) => onChange({ contextWindow: v })}
                  />
                </Field>
                <Field label={t('models.maxOutputToken')}>
                  <NumberField
                    label="maxTokens"
                    integer
                    value={model.maxTokens}
                    placeholder="16384"
                    onCommit={(v) => onChange({ maxTokens: v })}
                  />
                </Field>
              </div>
            </div>

            {/* Tier 2: Unified collapsible Advanced drawer — preserves 100% of advanced fields */}
            <div className="border-t border-[var(--settings-divider)] pt-3">
              <button
                type="button"
                aria-expanded={advancedOpen}
                data-testid={`model-advanced-toggle-${model.id}`}
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 text-left text-[12px] font-medium text-foreground-secondary hover:text-foreground"
              >
                <ChevronRight
                  className={cn('h-3 w-3 shrink-0 transition-transform', advancedOpen && 'rotate-90')}
                  strokeWidth={2}
                />
                <span>{t('models.advancedDrawerTitle')}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {t('models.advancedDrawerHint')}
                </span>
                {advancedCount > 0 ? (
                  <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[10.5px] tabular-nums text-foreground-secondary">
                    {advancedCount}
                  </span>
                ) : null}
              </button>

              {advancedOpen ? (
                <div className="mt-3.5 space-y-4">
                  <Group title={t('models.groupPricing')} hint={t('models.pricingHint')} cols={4}>
                    {COST_KEYS.map((k) => (
                      <Field key={k} label={t(`models.cost_${k}`)}>
                        <NumberField
                          label={`cost.${k}`}
                          value={cost[k]}
                          placeholder="0"
                          onCommit={(v) => setCost(k, v)}
                        />
                      </Field>
                    ))}
                  </Group>

                  <Group title={t('models.apiOverride')}>
                    <Field label={t('models.apiOverride')} span>
                      <select
                        className={cn(selectCls, fieldCls, 'w-full')}
                        value={model.api || ''}
                        onChange={(e) => onChange({ api: e.target.value || undefined })}
                      >
                        {API_OPTS.map((o) => (
                          <option key={o.v || '_inherit'} value={o.v}>
                            {o.l}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </Group>

                  <Group title={t('models.groupCache')} hint={t('models.cacheHint')} cols={4}>
                    <Field label={t('models.advanced.cache_short')}>
                      <NumberField
                        label="promptCache.short"
                        integer
                        value={getIn(model.promptCache, ['short'])}
                        placeholder="300"
                        onCommit={(v) => onChange({ promptCache: setIn(model.promptCache, ['short'], v) })}
                      />
                    </Field>
                    <Field label={t('models.advanced.cache_long')}>
                      <NumberField
                        label="promptCache.long"
                        integer
                        value={getIn(model.promptCache, ['long'])}
                        placeholder="3600"
                        onCommit={(v) => onChange({ promptCache: setIn(model.promptCache, ['long'], v) })}
                      />
                    </Field>
                    <div className="col-span-2 flex flex-col justify-end gap-1.5 pb-0.5">
                      {(['supportsMidConvoSystemMessages', 'supportsMidConvoToolAdditions'] as const).map(
                        (key) => (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground"
                            title={t('models.advanced.transcriptHint')}
                          >
                            <input
                              type="checkbox"
                              aria-label={`compat.${key}`}
                              className="settings-check h-3.5 w-3.5 rounded"
                              checked={getIn(model.compat, [key]) === true}
                              disabled={
                                key === 'supportsMidConvoToolAdditions' &&
                                getIn(model.compat, ['supportsMidConvoSystemMessages']) !== true
                              }
                              onChange={(e) => {
                                let compat = setIn(
                                  model.compat,
                                  [key],
                                  e.target.checked ? true : undefined,
                                )
                                if (key === 'supportsMidConvoSystemMessages' && !e.target.checked) {
                                  compat = setIn(compat, ['supportsMidConvoToolAdditions'], undefined)
                                }
                                onChange({ compat })
                              }}
                            />
                            {t(`models.advanced.${key}`)}
                          </label>
                        ),
                      )}
                    </div>
                  </Group>

                  {model.reasoning ? (
                    <Group title={t('models.thinkingLevelMap')} hint={t('models.thinkingMapHint')}>
                      <div className="space-y-1.5 sm:col-span-2">
                        {thinkingEntries.map(([key, val]) => (
                          <div key={key} className="flex items-center gap-2">
                            <select
                              className={cn(selectCls, fieldCls, 'w-32 shrink-0')}
                              value={key}
                              onChange={(e) => setThinkingKey(key, e.target.value)}
                            >
                              {THINKING_LEVEL_OPTIONS.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                            <ArrowRight
                              className="h-3 w-3 shrink-0 text-foreground-secondary"
                              strokeWidth={2}
                            />
                            <input
                              className={cn(fieldCls, 'font-mono')}
                              value={val ?? ''}
                              placeholder={t('models.thinkingParamPlaceholder')}
                              onChange={(e) => setThinkingValue(key, e.target.value)}
                            />
                            <button
                              type="button"
                              className="chrome-icon-btn shrink-0 rounded-md p-1 text-foreground-secondary hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeThinkingEntry(key)}
                              aria-label={t('common:delete')}
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[12px] text-foreground-secondary hover:text-foreground"
                          onClick={addThinkingEntry}
                        >
                          <Plus className="h-3 w-3" strokeWidth={2} />
                          {t('models.addBtn')}
                        </button>
                      </div>
                    </Group>
                  ) : null}

                  <ModelAdvancedFields model={model} onChange={onChange} embedded />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
