import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { AppIconComponent } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'

/** Content column widths: every page is centered; list-heavy pages get a wider column. */
export const SETTINGS_COLUMN = 'mx-auto w-full max-w-[820px]'
export const SETTINGS_COLUMN_WIDE = 'mx-auto w-full max-w-[1100px]'

/**
 * 设置主内容区。`pageKey` 变化时：内容淡入上移（页面切换动效）、滚动回到顶部，
 * 宽/窄两档列宽都居中，避免切页时内容左右跳动。
 */
export function SettingsMain({
  wide = false,
  pageKey,
  className,
  children,
  footer,
}: {
  wide?: boolean
  pageKey?: string
  className?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [pageKey])
  return (
    <main className={cn('settings-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]', className)}>
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="w-full px-5 pb-10 pt-7 sm:px-8 lg:px-10" scrollRef={scrollRef}>
        <div key={pageKey} className={cn('settings-page-enter', wide ? SETTINGS_COLUMN_WIDE : SETTINGS_COLUMN)}>
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
    <div className="settings-page-header mb-7 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold leading-7 tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-[1.65] text-foreground-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
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
      className="settings-nav flex h-full min-h-0 w-[208px] shrink-0 flex-col overflow-hidden border-r border-border/50 bg-surface-sidebar lg:w-[224px]"
      aria-label={title}
    >
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-2 pb-4 pt-4">
        <div className="settings-nav-content flex flex-col gap-4">{children}</div>
      </OverlayScrollHost>
    </nav>
  )
}

export function SettingsNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-nav-group flex flex-col gap-0.5">
      <div className="px-3 pb-1 text-[11px] font-medium tracking-wide text-foreground-secondary/65">{label}</div>
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
      aria-current={active ? 'page' : undefined}
      className={cn(
        'settings-nav-item flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px]',
        active
          ? 'bg-[var(--bg-active)] font-medium text-foreground'
          : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
    >
      <Icon className="settings-nav-icon h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{label}</span>
    </button>
  )
}
