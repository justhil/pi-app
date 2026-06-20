import { GitBranch } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type SessionTreeNode = {
  id: string
  depth: number
  label?: string
  entryType: string
  isLeaf: boolean
  role?: string
  preview?: string
  timestamp?: string
}

export function sessionTreeLineTitle(n: SessionTreeNode): string {
  if (n.label) return n.label
  if (n.entryType === 'message') {
    const who = n.role === 'user' ? 'user' : n.role === 'assistant' ? 'assistant' : 'message'
    const p = (n.preview || '').replace(/\s+/g, ' ').trim()
    const short = p.length > 120 ? `${p.slice(0, 120)}…` : p
    return short ? `${who}: ${short}` : who
  }
  if (n.entryType === 'compaction') return 'compaction'
  if (n.entryType === 'branch_summary') return 'branch summary'
  if (n.entryType === 'thinking_level_change') return 'thinking'
  if (n.entryType === 'model_change') return 'model'
  return n.entryType
}

const DEPTH_INDENT_PX = 12

export type TreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all'

export function filterSessionTreeNodes(nodes: SessionTreeNode[], mode: TreeFilterMode): SessionTreeNode[] {
  if (mode === 'all') return nodes
  return nodes.filter((n) => {
    if (mode === 'user-only') return n.entryType === 'message' && n.role === 'user'
    if (mode === 'labeled-only') return !!n.label
    if (mode === 'no-tools') {
      if (n.entryType === 'message') return true
      if (n.entryType === 'compaction' || n.entryType === 'branch_summary') return true
      return false
    }
    // default: hide pure meta entries except messages + compaction + branch_summary
    if (n.entryType === 'message' || n.entryType === 'compaction' || n.entryType === 'branch_summary') return true
    if (n.label) return true
    return false
  })
}

export function SessionTreeList({
  nodes,
  selectedId,
  onSelect,
  onActivate,
  className,
  rowClassName,
}: {
  nodes: SessionTreeNode[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  className?: string
  rowClassName?: string
}) {
  return (
    <ul className={cn('w-full min-w-0', className)}>
      {nodes.map((n) => {
        const selected = selectedId === n.id
        return (
          <li key={n.id} className="min-w-0">
            <button
              type="button"
              title={n.isLeaf ? '当前位置' : onActivate ? 'Enter 或双击跳转' : '跳转到此节点'}
              onClick={() => {
                onSelect?.(n.id)
                if (!n.isLeaf && onActivate && !onSelect) onActivate(n.id)
              }}
              onDoubleClick={() => !n.isLeaf && onActivate?.(n.id)}
              className={cn(
                'flex w-full min-w-0 items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors',
                selected && 'bg-primary/12 ring-1 ring-inset ring-primary/30',
                !selected && 'hover:bg-muted/70',
                n.isLeaf && !selected && 'bg-primary/6 font-medium',
                rowClassName,
              )}
            >
              <span
                className="shrink-0"
                style={{ width: Math.min(n.depth, 20) * DEPTH_INDENT_PX }}
                aria-hidden
              />
              <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />
              <span className="min-w-0 flex-1 break-words text-[12px] leading-snug text-foreground-secondary">
                {sessionTreeLineTitle(n)}
                {n.isLeaf && <span className="ml-1.5 whitespace-nowrap text-[10px] text-primary">← 当前</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}