import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Tool detail shell under ToolCallRow expand.
 * flat: body only (no nested header row — tool name already on the parent line).
 */
export function NativePreviewPanel({
  icon: _icon,
  title: _title,
  meta: _meta,
  stats: _stats,
  defaultOpen = false,
  forceOpen,
  flat = false,
  itemRunId: _itemRunId,
  children,
}: {
  icon: ReactNode
  title: string
  meta?: ReactNode
  stats?: ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
  /** Skip nested chrome; body always visible */
  flat?: boolean
  itemRunId?: string
  children: ReactNode
}) {
  if (flat || forceOpen === true) {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-[3px] border border-border/20 bg-[var(--bg-base)]/20',
        )}
      >
        {children}
      </div>
    )
  }

  // Legacy path: still no second interactive header — just body when defaultOpen.
  if (!defaultOpen) return null
  return (
    <div className="overflow-hidden rounded-[3px] border border-border/25 bg-[var(--bg-base)]/25">
      {children}
    </div>
  )
}
