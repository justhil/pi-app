import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { peekAvailableModels, subscribeAvailableModels } from '@renderer/lib/available-models-cache'
import { Plus, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { inputCls } from './settings-controls'
import { parseNumberInput } from './model-advanced'

const cellCls = cn(inputCls, 'h-7 px-2 py-0 text-right text-[12px] tabular-nums')

type Overrides = Record<string, { reserveTokens?: number; keepRecentTokens?: number }>

function Count({ value, placeholder, label, onCommit }: { value: unknown; placeholder: string; label: string; onCommit: (v: number | undefined) => void }) {
  const text = typeof value === 'number' ? String(value) : ''
  return (
    <input
      key={text}
      aria-label={label}
      inputMode="numeric"
      className={cellCls}
      defaultValue={text}
      placeholder={placeholder}
      onBlur={(e) => {
        const n = parseNumberInput(e.target.value, { integer: true, min: 0 })
        if (n === null) e.target.value = text
        else if (n !== (typeof value === 'number' ? value : undefined)) onCommit(n)
      }}
    />
  )
}

const BUDGET_LEVELS = ['minimal', 'low', 'medium', 'high'] as const

/** `thinkingBudgets`: token budget per thinking level; blank keeps pi's built-in budget. */
export function ThinkingBudgetsControl({ value, disabled, onChange }: { value: unknown; disabled?: boolean; onChange: (next: Record<string, number>) => void }) {
  const budgets = value && typeof value === 'object' ? (value as Record<string, number>) : {}
  return (
    <fieldset disabled={disabled} className="grid w-[min(22rem,70vw)] grid-cols-4 gap-1.5">
      {BUDGET_LEVELS.map((level) => (
        <label key={level} className="flex flex-col gap-0.5 font-mono text-[10.5px] text-muted-foreground/70">
          {level}
          <Count
            label={`thinkingBudgets.${level}`}
            value={budgets[level]}
            placeholder="·"
            onCommit={(v) => {
              const next = { ...budgets }
              if (v === undefined) delete next[level]
              else next[level] = v
              onChange(next)
            }}
          />
        </label>
      ))}
    </fieldset>
  )
}

/** `compaction.modelOverrides`: reserve / keep-recent tokens for specific `provider/modelId`s. */
export function CompactionOverridesControl({
  value,
  disabled,
  onChange,
}: {
  value: unknown
  disabled?: boolean
  onChange: (next: Overrides) => void
}) {
  const { t } = useTranslation()
  const available = useSyncExternalStore(subscribeAvailableModels, peekAvailableModels)
  const models = available.map((m) => `${m.provider}/${m.id}`)
  const overrides = value && typeof value === 'object' ? (value as Overrides) : {}
  const entries = Object.entries(overrides)
  const rename = (from: string, to: string) => {
    const key = to.trim()
    if (!key || key === from || Object.hasOwn(overrides, key)) return
    onChange(Object.fromEntries(entries.map(([k, v]) => (k === from ? [key, v] : [k, v]))))
  }
  const setField = (key: string, field: 'reserveTokens' | 'keepRecentTokens', v: number | undefined) => {
    const entry = { ...overrides[key] }
    if (v === undefined) delete entry[field]
    else entry[field] = v
    onChange({ ...overrides, [key]: entry })
  }
  const remove = (key: string) => onChange(Object.fromEntries(entries.filter(([k]) => k !== key)))
  const add = () => {
    const key = models.find((m) => !Object.hasOwn(overrides, m)) ?? `provider/model-${entries.length + 1}`
    onChange({ ...overrides, [key]: {} })
  }
  return (
    <fieldset disabled={disabled} className="w-[min(30rem,80vw)] space-y-1" data-compaction-overrides="">
      {entries.length > 0 ? (
        <div className="grid grid-cols-[1fr_6.5rem_6.5rem_1.5rem] gap-1 text-[10.5px] text-muted-foreground/70">
          <span>{t('settings:pi.overrideModel')}</span>
          <span className="text-right font-mono">reserve</span>
          <span className="text-right font-mono">keepRecent</span>
          <span />
        </div>
      ) : null}
      {entries.map(([key, entry]) => (
        <div key={key} className="grid grid-cols-[1fr_6.5rem_6.5rem_1.5rem] items-center gap-1">
          <input
            key={key}
            list="pi-settings-model-ids"
            aria-label={t('settings:pi.overrideModel')}
            className={cn(inputCls, 'h-7 py-0 text-[12px]')}
            defaultValue={key}
            onBlur={(e) => rename(key, e.target.value)}
          />
          <Count label={`${key} reserveTokens`} value={entry.reserveTokens} placeholder="16384" onCommit={(v) => setField(key, 'reserveTokens', v)} />
          <Count label={`${key} keepRecentTokens`} value={entry.keepRecentTokens} placeholder="20000" onCommit={(v) => setField(key, 'keepRecentTokens', v)} />
          <button
            type="button"
            aria-label={t('common:delete')}
            onClick={() => remove(key)}
            className="chrome-icon-btn rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      ))}
      <datalist id="pi-settings-model-ids">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <button type="button" onClick={add} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" strokeWidth={2} />
        {t('settings:pi.overrideAdd')}
      </button>
    </fieldset>
  )
}
