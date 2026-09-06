import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
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
  gitKind,
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
  gitKind?: 'modified' | 'added' | 'deleted'
  onToggle?: () => void
  onSelect: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation('files')
  const { Icon, className: iconClass } = fileTreeIcon(name, false)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isDirectory ? open : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={gitKind ? `${name} · ${t(`tree.git.${gitKind}`)}` : name}
      title={relativePath}
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
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
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
          aria-label={name}
          className="chrome-icon-btn flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
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
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] leading-[24px]',
          gitKind === 'added'
            ? 'text-[var(--diff-added)]'
            : gitKind === 'deleted'
              ? 'text-destructive'
              : gitKind === 'modified'
                ? 'text-[var(--warning-semantic)]'
                : 'text-foreground',
        )}
      >
        {name}
      </span>
      {gitKind && <span aria-hidden className="ml-1 shrink-0 pr-1 font-mono text-[11px] text-foreground-secondary">{gitKind === 'modified' ? 'M' : gitKind === 'added' ? 'A' : 'D'}</span>}
    </div>
  )
}