import { cn } from '@renderer/lib/utils'

/**
 * Git-style +N -M badge. High contrast — not muted timeline quiet text.
 */
export function DiffStatBadge({
  additions,
  deletions,
  className,
}: {
  additions: number
  deletions: number
  className?: string
}) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium tabular-nums leading-none',
        className,
      )}
    >
      {additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-rose-600 dark:text-rose-400">-{deletions}</span>
      )}
    </span>
  )
}
