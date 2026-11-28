import { useId, useState, type ReactNode } from 'react'
import { Check, Copy } from '@renderer/components/icons'
import { readAction, type ResolvedNode } from '../engine'
import {
  ChipButton,
  displayValue,
  optionIndex,
  readEnum,
  readNumber,
  readOptions,
  readText,
  useLiveBlock,
} from './live-context'
import { UIBlockAsk } from './ui-block-ask'

const INPUT_MAX_LENGTH = 200

function ControlLabel({ htmlFor, label, value }: { htmlFor?: string; label?: string; value?: ReactNode }) {
  if (!label && value === undefined) return null
  return (
    <div className="uib-live-ctrl-head">
      <label htmlFor={htmlFor} className="uib-live-ctrl-label">
        {label ?? ''}
      </label>
      {value !== undefined ? <span className="uib-live-ctrl-val">{value}</span> : null}
    </div>
  )
}

export function LiveSlider({ node }: { node: ResolvedNode }) {
  const { state, update } = useLiveBlock()
  const id = useId()
  const bind = node.bind
  if (!bind) return null
  const min = readNumber(node.props, 'min') ?? 0
  const declaredMax = readNumber(node.props, 'max') ?? 100
  const max = declaredMax > min ? declaredMax : min + 1
  const declaredStep = readNumber(node.props, 'step')
  const step = declaredStep !== undefined && declaredStep > 0 ? declaredStep : max - min >= 10 ? 1 : (max - min) / 100
  const current = state[bind]
  const value = typeof current === 'number' && Number.isFinite(current) ? Math.min(max, Math.max(min, current)) : min
  const unit = readText(node.props, 'unit')
  return (
    <div className="uib-live-ctrl">
      <ControlLabel
        htmlFor={id}
        label={readText(node.props, 'label')}
        value={
          <>
            {displayValue(value)}
            {unit ? <span className="uib-live-ctrl-unit">{unit}</span> : null}
          </>
        }
      />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) update({ [bind]: next })
        }}
        className="uib-live-range"
      />
    </div>
  )
}

export function LiveSelect({ node }: { node: ResolvedNode }) {
  const { state, update } = useLiveBlock()
  const id = useId()
  const bind = node.bind
  const options = readOptions(node.props, 'options')
  if (!bind || options.length === 0) return null
  const idx = optionIndex(options, state[bind])
  return (
    <div className="uib-live-ctrl">
      <ControlLabel htmlFor={id} label={readText(node.props, 'label')} />
      <select
        id={id}
        value={String(idx)}
        onChange={(e) => {
          const opt = options[Number.parseInt(e.target.value, 10)]
          if (opt) update({ [bind]: opt.value })
        }}
        className="uib-live-select"
      >
        {options.map((opt, i) => (
          <option key={`${node.path}-${i}`} value={String(i)}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function LiveSegmented({ node }: { node: ResolvedNode }) {
  const { state, update } = useLiveBlock()
  const bind = node.bind
  const options = readOptions(node.props, 'options')
  if (!bind || options.length === 0) return null
  const idx = optionIndex(options, state[bind])
  const label = readText(node.props, 'label')
  return (
    <div className="uib-live-ctrl">
      {label ? <div className="uib-live-ctrl-label uib-live-ctrl-label-gap">{label}</div> : null}
      <div role="tablist" aria-label={label} className="uib-live-chips">
        {options.map((opt, i) => (
          <ChipButton key={`${node.path}-${i}`} active={i === idx} onClick={() => update({ [bind]: opt.value })}>
            {opt.label}
          </ChipButton>
        ))}
      </div>
    </div>
  )
}

export function LiveSwitch({ node }: { node: ResolvedNode }) {
  const { state, update } = useLiveBlock()
  const id = useId()
  const bind = node.bind
  if (!bind) return null
  const checked = state[bind] === true
  return (
    <div className="uib-live-switch-row">
      <label htmlFor={id} className="uib-live-switch-label">
        {readText(node.props, 'label') ?? ''}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-checked={checked || undefined}
        onClick={() => update({ [bind]: !checked })}
        className="uib-live-switch"
      >
        <span className="uib-live-switch-thumb" />
      </button>
    </div>
  )
}

const INPUT_TYPES = ['text', 'number'] as const

function displayInput(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string') return v
  return ''
}

export function LiveInput({ node }: { node: ResolvedNode }) {
  const { state, update } = useLiveBlock()
  const id = useId()
  const bind = node.bind
  const numeric = readEnum(node.props, 'type', INPUT_TYPES) === 'number'
  const current = bind ? state[bind] : undefined
  const committed = displayInput(current)
  const [draft, setDraft] = useState(committed)
  const [lastCommitted, setLastCommitted] = useState(committed)
  if (committed !== lastCommitted) {
    setLastCommitted(committed)
    setDraft(committed)
  }
  if (!bind) return null
  return (
    <div className="uib-live-ctrl">
      <ControlLabel htmlFor={id} label={readText(node.props, 'label')} />
      <input
        id={id}
        type={numeric ? 'text' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        maxLength={INPUT_MAX_LENGTH}
        placeholder={readText(node.props, 'placeholder')}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          if (!numeric) {
            update({ [bind]: next })
            return
          }
          const parsed = Number(next.trim())
          if (next.trim() !== '' && Number.isFinite(parsed)) {
            update({ [bind]: parsed })
          }
        }}
        className="uib-live-input"
      />
    </div>
  )
}

const BUTTON_VARIANTS = ['default', 'outline'] as const

export function LiveButton({ node }: { node: ResolvedNode }) {
  const { stateNames, update } = useLiveBlock()
  const [copied, setCopied] = useState(false)
  const action = readAction(node.props, stateNames)
  if (!action) return null
  if (action.kind === 'ask') {
    return <UIBlockAsk suggestion={action.text} />
  }
  const variant = readEnum(node.props, 'variant', BUTTON_VARIANTS) ?? 'outline'
  const label = readText(node.props, 'label') ?? (action.kind === 'copy' ? '复制' : '应用')
  if (action.kind === 'copy') {
    return (
      <button
        type="button"
        data-variant={variant}
        onClick={() => {
          void navigator.clipboard.writeText(action.text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          })
        }}
        className="uib-live-btn"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span>{copied ? '已复制' : label}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      data-variant={variant}
      onClick={() => update(action.patch)}
      className="uib-live-btn"
    >
      {label}
    </button>
  )
}
