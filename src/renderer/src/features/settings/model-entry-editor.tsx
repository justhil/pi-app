import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { PiModelsProviderConfig } from '@shared/ipc-contract'

export type LocalModelEntry = NonNullable<PiModelsProviderConfig['models']>[number]

const inputCls =
  'settings-field-focus w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono'
const labelCls = 'text-[10px] font-medium text-muted-foreground/80'

const THINKING_LEVEL_OPTIONS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export function ModelEntryEditor({
  model,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
}: {
  model: LocalModelEntry
  expanded: boolean
  onToggleExpand: () => void
  onChange: (patch: Partial<LocalModelEntry>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const input = model.input || ['text']
  const hasText = input.includes('text')
  const hasImage = input.includes('image')

  const API_OPTS = [
    { v: '', l: t('models:inheritProvider') },
    { v: 'openai-completions', l: 'openai-completions' },
    { v: 'openai-responses', l: 'openai-responses' },
    { v: 'anthropic-messages', l: 'anthropic-messages' },
    { v: 'google-generative-ai', l: 'google-generative-ai' },
  ]

  const thinkingEntries = Object.entries(model.thinkingLevelMap || {})

  const updateThinkingMap = (next: Record<string, string>) => {
    onChange({ thinkingLevelMap: Object.keys(next).length ? next : undefined })
  }

  const setThinkingKey = (oldKey: string, newKey: string) => {
    const map = { ...(model.thinkingLevelMap || {}) }
    if (map[newKey] !== undefined) return
    const val = map[oldKey]
    delete map[oldKey]
    map[newKey] = val ?? newKey
    updateThinkingMap(map)
  }

  const setThinkingValue = (key: string, value: string) => {
    const map = { ...(model.thinkingLevelMap || {}) }
    map[key] = value
    updateThinkingMap(map)
  }

  const removeThinkingEntry = (key: string) => {
    const map = { ...(model.thinkingLevelMap || {}) }
    delete map[key]
    updateThinkingMap(map)
  }

  const addThinkingEntry = () => {
    const map = { ...(model.thinkingLevelMap || {}) }
    const available = THINKING_LEVEL_OPTIONS.find((o) => !map[o])
    if (available) {
      map[available] = available
      updateThinkingMap(map)
    }
  }

  const setInput = (text: boolean, image: boolean) => {
    const next: ('text' | 'image')[] = []
    if (text) next.push('text')
    if (image) next.push('image')
    onChange({ input: next.length ? next : ['text'] })
  }

  return (
    <div className="settings-model-entry overflow-hidden rounded-lg border border-border/55 bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="settings-provider-header interactive-row flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
          onClick={onToggleExpand}
        >
          <ChevronRight
            className="settings-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground"
            data-open={expanded}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px] font-medium text-foreground" title={model.id}>
              {model.id}
            </div>
            {model.name && model.name !== model.id && (
              <div className="truncate text-[11px] text-muted-foreground">{model.name}</div>
            )}
          </div>
          <div className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
            {model.reasoning && (
              <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[9px] font-medium text-violet-700 transition-opacity duration-motion-fast dark:text-violet-300">
                {t('models:reasoningBadge')}
              </span>
            )}
            {hasImage && (
              <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[9px] font-medium text-sky-700 transition-opacity duration-motion-fast dark:text-sky-300">
                {t('models:multimodalBadge')}
              </span>
            )}
            {model.contextWindow != null && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                ctx {formatK(model.contextWindow)}
              </span>
            )}
          </div>
        </button>
        <button
          type="button"
          className="chrome-icon-btn rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label={t('common:delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="settings-expand-grid" data-open={expanded}>
        <div className="settings-expand-inner">
          <div className="settings-model-entry-panel grid gap-3 border-t border-border/40 bg-muted/10 px-3 py-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('models:modelIdApi')}</label>
              <input
                className={inputCls}
                value={model.id}
                readOnly
                title=""
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('models:displayName')}</label>
              <input
                className={cn(inputCls, 'font-sans')}
                value={model.name || ''}
                placeholder={model.id}
                onChange={(e) => onChange({ name: e.target.value || undefined })}
              />
            </div>
            <div>
              <label className={labelCls}>{t('models:apiOverride')}</label>
              <select
                className={cn(inputCls, 'font-sans')}
                value={model.api || ''}
                onChange={(e) => onChange({ api: e.target.value || undefined })}
              >
                {API_OPTS.map((o) => (
                  <option key={o.v || '_inherit'} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="rounded border-border transition-colors duration-motion-fast"
                  checked={!!model.reasoning}
                  onChange={(e) => onChange({ reasoning: e.target.checked || undefined })}
                />
                {t('models:reasoningModel')}
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('models:inputLabel')}</label>
              <div className="mt-1 flex gap-2">
                <ToggleChip active={hasText} onClick={() => setInput(!hasText, hasImage)} label="Text" />
                <ToggleChip active={hasImage} onClick={() => setInput(hasText, !hasImage)} label={t('models:imageLabel')} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('models:contextWindowLabel')}</label>
              <input
                type="number"
                className={inputCls}
                min={0}
                step={1024}
                placeholder="128000"
                value={model.contextWindow ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onChange({ contextWindow: v === '' ? undefined : Math.max(0, Number(v)) })
                }}
              />
            </div>
            <div>
              <label className={labelCls}>{t('models:maxOutputToken')}</label>
              <input
                type="number"
                className={inputCls}
                min={0}
                step={256}
                placeholder="16384"
                value={model.maxTokens ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onChange({ maxTokens: v === '' ? undefined : Math.max(0, Number(v)) })
                }}
              />
            </div>
            {model.reasoning && (
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelCls}>{t('models:thinkingLevelMap')}</label>
                  <button
                    type="button"
                    className="settings-chip flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={addThinkingEntry}
                  >
                    <Plus className="h-3 w-3" />
                    {t('models:addBtn')}
                  </button>
                </div>
                <p className="mb-2 text-[10px] text-muted-foreground/60">
                  {/* GUI level name (left) · model param (right). Default high; higher maps here. */}
                </p>
                {thinkingEntries.length > 0 && (
                  <div className="space-y-1.5">
                    {thinkingEntries.map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2">
                        <select
                          className={cn(inputCls, 'w-32 shrink-0 font-sans')}
                          value={key}
                          onChange={(e) => setThinkingKey(key, e.target.value)}
                        >
                          {THINKING_LEVEL_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <span className="shrink-0 text-[10px] text-muted-foreground">→</span>
                        <input
                          className={cn(inputCls, 'font-mono')}
                          value={val}
                          placeholder={t('models:thinkingParamPlaceholder')}
                          onChange={(e) => setThinkingValue(key, e.target.value)}
                        />
                        <button
                          type="button"
                          className="chrome-icon-btn shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeThinkingEntry(key)}
                          aria-label={t('common:delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'settings-chip rounded-full border px-3 py-1 text-[11px]',
        active
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border/60 text-muted-foreground',
      )}
    >
      {label}
    </button>
  )
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}