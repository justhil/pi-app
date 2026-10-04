import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
import { inputCls as settingsInputCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'
import { IMAGE_RESIZE_KEYS, PROMPT_CACHE_KEYS, SAMPLING_KEYS, getIn, hasAdvanced, parseNumberInput, setIn } from './model-advanced'
import type { LocalModelEntry } from './model-entry-editor'

const cellCls = cn(settingsInputCls, 'h-6 px-1.5 py-0 text-right text-[11px] tabular-nums')
const labelCls = 'text-2xs font-medium text-muted-foreground/70'
const hintCls = 'text-2xs leading-4 text-muted-foreground/55'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

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
 * Collapsible "Advanced" block of a model entry: sampling (base + per thinking level, OpenAI-compatible
 * APIs), image input limits and prompt cache lifetimes. Writes straight into the entry's fields.
 */
export function ModelAdvancedFields({ model, onChange }: { model: LocalModelEntry; onChange: (patch: Partial<LocalModelEntry>) => void }) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(() => hasAdvanced(model))
  const hasImage = Array.isArray(model.input) && model.input.includes('image')
  const levels = model.reasoning ? LEVELS : (['off'] as const)

  return (
    <div className="sm:col-span-2" data-model-advanced="">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} strokeWidth={2} />
        {t('models.advanced.title')}
      </button>
      {open ? (
        <div className="mt-2 space-y-3 border-l border-border/60 pl-3">
          <div>
            <div className={labelCls}>{t('models.advanced.sampling')}</div>
            <p className={hintCls}>{t('models.advanced.samplingHint')}</p>
            <table className="mt-1 w-full max-w-[26rem] border-separate border-spacing-x-1 border-spacing-y-0.5 text-[11px]">
              <thead>
                <tr className="text-muted-foreground/70">
                  <th className="w-20 text-left font-normal" />
                  {SAMPLING_KEYS.map((k) => (
                    <th key={k} className="text-right font-normal font-mono">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-muted-foreground">{t('models.advanced.base')}</td>
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
                    <td className="font-mono text-muted-foreground">{level}</td>
                    {SAMPLING_KEYS.map((k) => (
                      <td key={k}>
                        <NumCell
                          label={`samplingParamsByThinkingLevel.${level}.${k}`}
                          value={getIn(model.samplingParamsByThinkingLevel, [level, k])}
                          integer={k === 'top_k'}
                          min={0}
                          placeholder="·"
                          onCommit={(v) => onChange({ samplingParamsByThinkingLevel: setIn(model.samplingParamsByThinkingLevel, [level, k], v) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasImage ? (
            <div>
              <div className={labelCls}>{t('models.advanced.images')}</div>
              <p className={hintCls}>{t('models.advanced.imagesHint')}</p>
              <div className="mt-1 grid max-w-[26rem] grid-cols-4 gap-1">
                {IMAGE_RESIZE_KEYS.map((k) => (
                  <label key={k} className="flex flex-col gap-0.5 text-[10.5px] text-muted-foreground/70">
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
            </div>
          ) : null}

          <div>
            <div className={labelCls}>{t('models.advanced.promptCache')}</div>
            <p className={hintCls}>{t('models.advanced.promptCacheHint')}</p>
            <div className="mt-1 grid max-w-[13rem] grid-cols-2 gap-1">
              {PROMPT_CACHE_KEYS.map((k) => (
                <label key={k} className="flex flex-col gap-0.5 text-[10.5px] text-muted-foreground/70">
                  <span>{t(`models.advanced.cache_${k}`)}</span>
                  <NumCell
                    label={`promptCache.${k}`}
                    value={getIn(model.promptCache, [k])}
                    integer
                    min={1}
                    placeholder={k === 'short' ? '300' : '3600'}
                    onCommit={(v) => onChange({ promptCache: setIn(model.promptCache, [k], v) })}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className={labelCls}>{t('models.advanced.transcript')}</div>
            <p className={hintCls}>{t('models.advanced.transcriptHint')}</p>
            <div className="mt-1 flex flex-col gap-1">
              {(['supportsMidConvoSystemMessages', 'supportsMidConvoToolAdditions'] as const).map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-[11.5px] text-foreground-secondary">
                  <input
                    type="checkbox"
                    aria-label={`compat.${key}`}
                    className="h-3.5 w-3.5 rounded border-border [accent-color:hsl(var(--foreground))]"
                    checked={getIn(model.compat, [key]) === true}
                    disabled={key === 'supportsMidConvoToolAdditions' && getIn(model.compat, ['supportsMidConvoSystemMessages']) !== true}
                    onChange={(e) => {
                      let compat = setIn(model.compat, [key], e.target.checked ? true : undefined)
                      if (key === 'supportsMidConvoSystemMessages' && !e.target.checked) compat = setIn(compat, ['supportsMidConvoToolAdditions'], undefined)
                      onChange({ compat })
                    }}
                  />
                  {t(`models.advanced.${key}`)}
                  <code className="font-mono text-[10.5px] text-muted-foreground/60">{key}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
