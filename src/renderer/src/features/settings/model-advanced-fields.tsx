import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
import { inputCls as settingsInputCls, selectCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'
import { IMAGE_RESIZE_KEYS, SAMPLING_KEYS, getIn, hasAdvanced, parseNumberInput, setIn } from './model-advanced'
import type { LocalModelEntry } from './model-entry-editor'

const cellCls = cn(settingsInputCls, 'settings-field h-[28px] px-2 py-0 text-right text-[12px] tabular-nums')
const titleCls = 'text-[12px] font-medium text-foreground'
const hintCls = 'text-[11.5px] leading-[1.5] text-foreground-secondary'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** OpenAI-compatible request quirks; unset means pi detects them from the URL. */
const COMPAT_BOOLS = ['supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming'] as const
const COMPAT_CHOICES = {
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  thinkingFormat: ['openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'qwen-chat-template', 'chat-template', 'string-thinking'],
} as const

/** Number input that commits on blur; blank clears the key, invalid text snaps back. */
function NumCell({
  value,
  placeholder,
  integer,
  min,
  max,
  label,
  onCommit,
}: {
  value: unknown
  placeholder?: string
  integer?: boolean
  min?: number
  max?: number
  label: string
  onCommit: (v: number | undefined) => void
}) {
  const text = typeof value === 'number' ? String(value) : ''
  return (
    <input
      key={text}
      aria-label={label}
      inputMode="decimal"
      className={cellCls}
      defaultValue={text}
      placeholder={placeholder}
      onBlur={(e) => {
        const parsed = parseNumberInput(e.target.value, { integer, min, max })
        if (parsed === null) {
          e.target.value = text
          return
        }
        if (parsed !== (typeof value === 'number' ? value : undefined)) onCommit(parsed)
      }}
    />
  )
}

/**
 * Collapsible "Advanced" block of a model entry: sampling (base + per thinking level), image input
 * limits, and compatibility switches for OpenAI-compatible endpoints.
 */
export function ModelAdvancedFields({ model, onChange }: { model: LocalModelEntry; onChange: (patch: Partial<LocalModelEntry>) => void }) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(() => hasAdvanced(model))
  const hasImage = Array.isArray(model.input) && model.input.includes('image')
  const levels = model.reasoning ? LEVELS : (['off'] as const)
  const compatValue = (key: string) => getIn(model.compat, [key])

  return (
    <div data-model-advanced="" className="border-t border-[var(--settings-divider)] pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[12px] text-foreground-secondary hover:text-foreground">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} strokeWidth={2} />
        {t('models.advanced.title')}
      </button>
      {open ? (
        <div className="mt-3 space-y-5">
          <section>
            <h4 className={titleCls}>{t('models.advanced.sampling')}</h4>
            <p className={hintCls}>{t('models.advanced.samplingHint')}</p>
            <table className="mt-2 w-full max-w-[28rem] border-separate border-spacing-x-1.5 border-spacing-y-1 text-[12px]">
              <thead>
                <tr className="text-foreground-secondary">
                  <th className="w-20 text-left font-normal" />
                  {SAMPLING_KEYS.map((k) => (
                    <th key={k} className="text-right font-mono text-[11.5px] font-normal">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-foreground-secondary">{t('models.advanced.base')}</td>
                  {SAMPLING_KEYS.map((k) => (
                    <td key={k}>
                      <NumCell
                        label={`samplingParams.${k}`}
                        value={getIn(model.samplingParams, [k])}
                        integer={k === 'top_k'}
                        min={0}
                        onCommit={(v) => onChange({ samplingParams: setIn(model.samplingParams, [k], v) })}
                      />
                    </td>
                  ))}
                </tr>
                {levels.map((level) => (
                  <tr key={level}>
                    <td className="font-mono text-foreground-secondary">{level}</td>
                    {SAMPLING_KEYS.map((k) => (
                      <td key={k}>
                        <NumCell
                          label={`samplingParamsByThinkingLevel.${level}.${k}`}
                          value={getIn(model.samplingParamsByThinkingLevel, [level, k])}
                          integer={k === 'top_k'}
                          min={0}
                          placeholder="—"
                          onCommit={(v) => onChange({ samplingParamsByThinkingLevel: setIn(model.samplingParamsByThinkingLevel, [level, k], v) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {hasImage ? (
            <section>
              <h4 className={titleCls}>{t('models.advanced.images')}</h4>
              <p className={hintCls}>{t('models.advanced.imagesHint')}</p>
              <div className="mt-2 grid max-w-[28rem] grid-cols-4 gap-1.5">
                {IMAGE_RESIZE_KEYS.map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-[11.5px] text-foreground-secondary">
                    <span className="font-mono">{k}</span>
                    <NumCell
                      label={`inputLimits.images.resize.${k}`}
                      value={getIn(model.inputLimits, ['images', 'resize', k])}
                      integer
                      min={1}
                      max={k === 'jpegQuality' ? 100 : undefined}
                      placeholder={{ maxWidth: '2000', maxHeight: '2000', maxBytes: '4.5M', jpegQuality: '80' }[k]}
                      onCommit={(v) => onChange({ inputLimits: setIn(model.inputLimits, ['images', 'resize', k], v) })}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h4 className={titleCls}>{t('models.advanced.compat')}</h4>
            <p className={hintCls}>{t('models.advanced.compatHint')}</p>
            <div className="mt-2 grid max-w-[40rem] gap-x-4 gap-y-2 sm:grid-cols-2">
              {COMPAT_BOOLS.map((key) => (
                <label key={key} className="flex items-center justify-between gap-3 text-[12px] text-foreground">
                  <span className="min-w-0 truncate">{t(`models.advanced.${key}`)}</span>
                  <select
                    aria-label={`compat.${key}`}
                    className={cn(selectCls, 'settings-field h-[28px] min-w-[6.5rem] py-0 text-[12px]')}
                    value={compatValue(key) === true ? 'yes' : compatValue(key) === false ? 'no' : 'auto'}
                    onChange={(e) => onChange({ compat: setIn(model.compat, [key], e.target.value === 'auto' ? undefined : e.target.value === 'yes') })}
                  >
                    <option value="auto">{t('models.advanced.auto')}</option>
                    <option value="yes">{t('models.advanced.yes')}</option>
                    <option value="no">{t('models.advanced.no')}</option>
                  </select>
                </label>
              ))}
              {(Object.keys(COMPAT_CHOICES) as (keyof typeof COMPAT_CHOICES)[]).map((key) => (
                <label key={key} className="flex items-center justify-between gap-3 text-[12px] text-foreground">
                  <span className="min-w-0 truncate">{t(`models.advanced.${key}`)}</span>
                  <select
                    aria-label={`compat.${key}`}
                    className={cn(selectCls, 'settings-field h-[28px] min-w-[6.5rem] py-0 font-mono text-[12px]')}
                    value={typeof compatValue(key) === 'string' ? String(compatValue(key)) : ''}
                    onChange={(e) => onChange({ compat: setIn(model.compat, [key], e.target.value || undefined) })}
                  >
                    <option value="">{t('models.advanced.auto')}</option>
                    {COMPAT_CHOICES[key].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
