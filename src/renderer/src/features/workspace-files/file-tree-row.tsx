import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { setPiFilePathDrag } from './workspace-files-types'
import { joinWorkspacePath } from './path-utils'
import { fileTreeIcon } from './file-tree-icons'

export function FileTreeRow({
  workspaceRoot,
  name,
  relativePath,
  isDirectory,
  depth,
  open,
  selected,
  onToggle,
  onSelect,
  onContextMenu,
}: {
  workspaceRoot: string
  name: string
  relativePath: string
  isDirectory: boolean
  depth: number
  open?: boolean
  selected?: boolean
  onToggle?: () => void
  onSelect: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const { Icon, className: iconClass } = fileTreeIcon(name, false)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!isDirectory}
      onDragStart={(e) => {
        if (isDirectory) {
          e.preventDefault()
          return
        }
        setPiFilePathDrag(e.dataTransfer, joinWorkspacePath(workspaceRoot, relativePath), name)
      }}
      onClick={(e) => {
        if (isDirectory) onToggle?.()
        onSelect(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (isDirectory) onToggle?.()
          onSelect(e as unknown as React.MouseEvent)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      className={cn(
        'files-tree-row nav-row mb-0.5 flex min-h-[26px] cursor-pointer items-center gap-1 rounded-lg px-1.5 py-0.5',
        selected ? 'nav-row-active' : 'text-foreground-secondary hover:text-foreground',
      )}
      style={{ marginLeft: depth > 0 ? 0 : undefined }}
    >
      {isDirectory ? (
        <button
          type="button"
          tabIndex={-1}
          className="chrome-icon-btn flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
        >
          <ChevronRight
            className={cn('chevron-expand h-3 w-3 shrink-0', open && 'rotate-90')}
            data-open={open ? 'true' : 'false'}
          />
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}
      {!isDirectory ? (
        <Icon className={cn('h-[16px] w-[16px] shrink-0 stroke-[1.75]', iconClass)} />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[12px] leading-[22px] text-foreground">{name}</span>
    </div>
  )
}