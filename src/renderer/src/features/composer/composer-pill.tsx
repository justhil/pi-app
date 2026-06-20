import { cn } from '@renderer/lib/utils'
import type { ReactNode } from 'react'

/** 模型 / Thinking 等可点击状态药丸（桌面 Agent UI sendbox 底部 chip 手感） */
export function ComposerPill({
  icon,
  label,
  open,
  active,
  onClick,
  title,
  className,
}: {
  icon: ReactNode
  label: ReactNode
  open?: boolean
  active?: boolean
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'composer-pill group/pill flex max-w-[min(220px,45vw)] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11px]',
        active && 'composer-pill-active',
        open && 'composer-pill-open',
        className,
      )}
    >
      <span className="shrink-0 text-foreground-secondary transition-colors duration-[var(--motion-fast)] group-hover/pill:text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground transition-colors duration-[var(--motion-fast)] group-hover/pill:text-foreground">
        {label}
      </span>
      <svg
        className={cn(
          'h-2.5 w-2.5 shrink-0 text-foreground-secondary/70 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
          open && 'rotate-180 text-brand',
        )}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  )
}