import { Children, createContext, isValidElement, useContext, useId, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { Switch } from '@renderer/components/ui/switch'

export const SettingsSearchContext = createContext('')
const SettingsSectionSearchContext = createContext(false)

/** Section titles can match every row in that section. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  const query = useContext(SettingsSearchContext).trim().toLocaleLowerCase()
  const sectionMatches = !!query && `${title} ${description || ''}`.toLocaleLowerCase().includes(query)
  return (
    <SettingsSectionSearchContext.Provider value={sectionMatches}>
    <section className="settings-section">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold leading-5 text-foreground">{title}</h3>
          {description && <p className="mt-0.5 max-w-2xl text-[12.5px] leading-[1.6] text-foreground-secondary">{description}</p>}
        </div>
        {action}
      </div>
      <div className="settings-section-rows settings-card">{children}</div>
    </section>
    </SettingsSectionSearchContext.Provider>
  )
}

function optionText(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : ''
  }).join(' ')
}

export function SettingRow({
  label,
  description,
  settingKey,
  badge,
  className,
  children,
}: {
  label: string
  description?: string
  /** Underlying settings.json key, shown small for people who edit the file directly. */
  settingKey?: string
  /** Small trailing tag after the label (e.g. "pi ≥ 0.86"). */
  badge?: ReactNode
  className?: string
  children: ReactNode
}) {
  const query = useContext(SettingsSearchContext).trim().toLocaleLowerCase()
  const sectionMatches = useContext(SettingsSectionSearchContext)
  const labelId = useId()
  const matches = !query || sectionMatches || `${label} ${description || ''} ${settingKey || ''} ${optionText(children)}`.toLocaleLowerCase().includes(query)
  if (!matches) return null
  return (
    <div className={cn('settings-row flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        <div id={labelId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium leading-5 text-foreground">
          <span>{label}</span>
          {badge}
        </div>
        {description && <div className="mt-0.5 max-w-xl text-[12px] leading-[1.55] text-foreground-secondary">{description}</div>}
      </div>
      <div role="group" aria-labelledby={labelId} className="settings-row-control min-w-0 shrink-0 sm:ml-6">{children}</div>
    </div>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
}
