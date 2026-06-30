import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** 纯 CSS grid 0fr↔1fr；大目录用 motion=none 避免动画期间布局海量节点 */
export function FileTreeFolderExpand({
  open,
  children,
  className,
  motion = 'normal',
}: {
  open: boolean
  children: ReactNode
  className?: string
  motion?: 'normal' | 'none'
}) {
  return (
    <div
      className={cn(
        'files-tree-folder-expand',
        motion === 'none' && 'files-tree-folder-expand--instant',
        className,
      )}
      data-open={open ? 'true' : 'false'}
    >
      <div className="files-tree-folder-expand-inner">{children}</div>
    </div>
  )
}