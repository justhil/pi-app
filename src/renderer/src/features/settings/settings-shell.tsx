import type { ReactNode } from 'react'
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
      <OverlayScrollHost
        className="min-h-0 flex-1"
        scrollClassName={cn(
          wide ? 'w-full px-5 py-6 sm:px-8 lg:px-10' : 'w-full px-5 py-6 sm:px-8 lg:px-10',
        )}
      >
        <div className={cn('w-full', wide ? 'max-w-none' : 'mx-auto max-w-3xl')}>
          {children}
        </div>
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
        <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-muted-foreground/80">{description}</p>
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
      className="flex h-full min-h-0 w-[220px] shrink-0 flex-col overflow-hidden border-r border-border/50 bg-[var(--surface-sidebar)] sm:w-56"
      aria-label={title}
    >
      <div className="shrink-0 px-4 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/45">
        {title}
      </div>
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-2 pb-4">
        <div className="flex flex-col gap-0.5">{children}</div>
      </OverlayScrollHost>
    </nav>
  )
}

export function SettingsNavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors duration-motion-fast ease-motion-ease',
        active
          ? 'bg-[var(--bg-active)] font-medium text-foreground'
          : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </button>
  )
}