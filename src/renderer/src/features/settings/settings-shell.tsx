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
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="w-full px-6 pb-12 pt-7 sm:px-9 lg:px-12" scrollRef={scrollRef}>
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
    <div className="settings-page-header mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[19px] font-semibold leading-7 tracking-[-0.02em] text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-[1.6] text-foreground-secondary/85">{description}</p>
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
      className="settings-nav flex h-full min-h-0 w-[212px] shrink-0 flex-col overflow-hidden lg:w-[228px]"
      style={{ background: 'var(--surface-frame)' }}
      aria-label={title}
    >
      <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-2.5 pb-5 pt-2.5">
        <div className="settings-nav-content flex flex-col gap-4">{children}</div>
      </OverlayScrollHost>
    </nav>
  )
}

export function SettingsNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-nav-group flex flex-col gap-0.5">
      <div className="px-2.5 pb-1 text-[11.5px] font-normal text-foreground-secondary/60">{label}</div>
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
        'settings-nav-item flex min-h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]',
        active
          ? 'bg-foreground/[0.07] font-medium text-foreground'
          : 'text-foreground-secondary/85 hover:bg-foreground/[0.045] hover:text-foreground',
      )}
    >
      <Icon
        className={cn('settings-nav-icon h-[15px] w-[15px] shrink-0', active ? 'text-foreground' : 'opacity-75')}
        strokeWidth={1.6}
      />
      <span className="truncate">{label}</span>
    </button>
  )
}
