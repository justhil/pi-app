import { cn } from '@renderer/lib/utils'

/** 高度折叠（grid 0fr → 1fr）。animated 仅用于侧栏等轻量场景；工具详情默认瞬时切换以降低布局成本。 */
export function CollapsiblePanel({
  open,
  children,
  className,
  animated = false,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
  animated?: boolean
}) {
  return (
    <div
      className={cn(
        'expand-panel',
        animated && 'expand-panel-animated',
        open && 'expand-panel-open',
        className,
      )}
      data-open={open ? 'true' : 'false'}
    >
      <div className="expand-panel-inner">{children}</div>
    </div>
  )
}