import { cn } from '@renderer/lib/utils'

/** 高度折叠动画（grid 0fr → 1fr），用于工具详情、工具组列表 */
export function CollapsiblePanel({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('expand-panel', open && 'expand-panel-open', className)}
      data-open={open ? 'true' : 'false'}
    >
      <div className="expand-panel-inner">{children}</div>
    </div>
  )
}