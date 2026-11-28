import { createContext, Fragment, useContext, type ReactNode } from 'react'
import { asUIValue, formatTemplateNumber, valuesEqual, type ResolvedNode, type UIValue } from '../engine'

export const LIVE_TONES = ['default', 'muted', 'positive', 'negative', 'warning', 'info'] as const
export type LiveTone = (typeof LIVE_TONES)[number]

export interface LiveBlockContextValue {
  blockKey: string
  streaming: boolean
  state: Readonly<Record<string, UIValue>>
  values: Readonly<Record<string, UIValue>>
  stateNames: ReadonlySet<string>
  update: (patch: Record<string, UIValue>) => void
  changed: boolean
  reset: () => void
  renderNode: (node: ResolvedNode) => ReactNode
}

export const LiveBlockContext = createContext<LiveBlockContextValue | null>(null)

export function useLiveBlock(): LiveBlockContextValue {
  const ctx = useContext(LiveBlockContext)
  if (!ctx) throw new Error('useLiveBlock must be used inside LiveBlockContext')
  return ctx
}

export function LiveChildren({ node }: { node: ResolvedNode }) {
  const { renderNode } = useLiveBlock()
  return (
    <>
      {node.children.map((child) => (
        <Fragment key={child.path}>{renderNode(child)}</Fragment>
      ))}
    </>
  )
}

export function readText(props: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const v = props[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

export function readNumber(props: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const v = props[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export function readBoolean(props: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const v = props[key]
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

export function readEnum<const T extends string>(
  props: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = props[key]
  if (typeof v !== 'string') return undefined
  const norm = v.trim().toLowerCase()
  return (allowed as readonly string[]).includes(norm) ? (norm as T) : undefined
}

export type LiveOption = { label: string; value: UIValue }

export function readOptions(props: Readonly<Record<string, unknown>>, key: string): LiveOption[] {
  const raw = props[key]
  if (!Array.isArray(raw)) return []
  const out: LiveOption[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      out.push({ label: String(entry), value: entry })
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>
      const val = asUIValue(obj.value ?? obj.label)
      const label = typeof obj.label === 'string' ? obj.label : val != null ? String(val) : ''
      if (label && val !== undefined) out.push({ label, value: val })
    }
  }
  return out
}

export function optionIndex(options: readonly LiveOption[], current: UIValue | undefined): number {
  if (current === undefined) return 0
  const idx = options.findIndex((opt) => valuesEqual(opt.value, current))
  return idx >= 0 ? idx : 0
}

export function displayValue(value: unknown, precision?: number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (precision !== undefined) {
      const d = Math.min(6, Math.max(0, Math.round(precision)))
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(value)
    }
    return formatTemplateNumber(value)
  }
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return '—'
  return JSON.stringify(value)
}

export function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active || undefined}
      onClick={onClick}
      className="uib-live-chip"
    >
      {children}
    </button>
  )
}
