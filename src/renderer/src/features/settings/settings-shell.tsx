import type { ReactNode } from 'react'
import type { AppIconComponent } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'

/** 设置主内容区：占满 TopBar 下方剩余宽度，宽页不套窄 max-w */
export function SettingsMain({
  wide = false,
  className,
  children,
  footer,
}: {
  wide?: boolean
  className?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]', className)}>
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="w-full px-5 py-6 sm:px-8 lg:px-10">
        <div className={cn('w-full', wide ? 'max-w-none' : 'mx-auto max-w-3xl')}>{children}</div>
      </OverlayScrollHost>
      {footer}
    </main>
  )
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground/70">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function SettingsNav({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <nav
      className="flex h-full min-h-0 w-[220px] shrink-0 flex-col overflow-hidden border-r border-border/50 bg-surface-sidebar sm:w-56"
      aria-label={title}
    >
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-2 pb-4 pt-5">
        <div className="flex flex-col gap-4">{children}</div>
      </OverlayScrollHost>
    </nav>
  )
}

export function SettingsNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-3 pb-1 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/50">{label}</div>
      {children}
    </div>
  )
}

export function SettingsNavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: AppIconComponent
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-base transition-colors duration-motion-fast ease-motion-ease',
        active
          ? 'bg-[var(--bg-active)] font-medium text-foreground'
          : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{label}</span>
    </button>
  )
}
