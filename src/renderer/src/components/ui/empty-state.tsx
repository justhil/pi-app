import { memo } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Shared empty / placeholder surface for home, timeline, and settings shells.
 * Display-only; no agent-loop side effects.
 */
export const EmptyState = memo(function EmptyState({
  title,
  description,
  className,
  children,
  compact,
}: {
  title: string
  description?: string
  className?: string
  children?: React.ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center px-6 text-center',
        compact ? 'gap-1.5 py-6' : 'gap-2 py-10',
        'animate-in fade-in duration-[var(--motion-slow)]',
        className,
      )}
    >
      <div
        className={cn(
          'font-medium text-foreground/90',
          compact ? 'text-[13px]' : 'text-[14px]',
        )}
      >
        {title}
      </div>
      {description ? (
        <p
          className={cn(
            'max-w-xs leading-relaxed text-foreground-secondary/70',
            compact ? 'text-[11px]' : 'text-[12px]',
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
    </div>
  )
})
