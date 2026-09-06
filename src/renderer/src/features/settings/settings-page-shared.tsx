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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {description && <p className="mb-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <div className="settings-section-rows divide-y divide-border/40">{children}</div>
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
  className,
  children,
}: {
  label: string
  description?: string
  className?: string
  children: ReactNode
}) {
  const query = useContext(SettingsSearchContext).trim().toLocaleLowerCase()
  const sectionMatches = useContext(SettingsSectionSearchContext)
  const labelId = useId()
  const matches = !query || sectionMatches || `${label} ${description || ''} ${optionText(children)}`.toLocaleLowerCase().includes(query)
  if (!matches) return null
  return (
    <div className={cn('settings-row flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-[13px] font-medium text-foreground">{label}</div>
        {description && <div className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      <div role="group" aria-labelledby={labelId} className="settings-row-control min-w-0 shrink-0 sm:ml-6">{children}</div>
    </div>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
}
