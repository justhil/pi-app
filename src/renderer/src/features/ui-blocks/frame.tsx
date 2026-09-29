import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** Shared chrome for every pi-ui block: optional title row with right-aligned actions. */
export function BlockFrame({
  title,
  actions,
  children,
  className,
  animate,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  animate?: boolean
}) {
  return (
    <section className={cn('uib-frame', animate && 'uib-enter', className)}>
      {title || actions ? (
        <header className="uib-header">
          {title ? <h4 className="uib-title">{title}</h4> : <span />}
          {actions ? <div className="uib-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

/** Compact segmented toggle (views, scales, filters). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="uib-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="uib-seg-item"
          data-active={option.value === value || undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
