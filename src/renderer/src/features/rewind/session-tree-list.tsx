import { Bot, GitBranch, MessageSquare, Sparkles, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '@renderer/lib/utils'
import { buildGitLaneLayout } from './session-tree-git-lanes'
import { SessionTreeGraphColumn } from './session-tree-graph-column'

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

function nodeIcon(n: SessionTreeNode) {
  if (n.entryType === 'message' && n.role === 'user') return MessageSquare
  if (n.entryType === 'message' && n.role === 'assistant') return Bot
  if (n.entryType === 'compaction' || n.entryType === 'branch_summary') return Sparkles
  if (n.entryType.includes('tool') || n.entryType === 'tool') return Wrench
  return GitBranch
}

export function SessionTreeList({
  nodes,
  selectedId,
  onSelect,
  onActivate,
  className,
  rowClassName,
  showGuides = true,
}: {
  nodes: SessionTreeNode[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  className?: string
  rowClassName?: string
  /** false：仅文本列表（大树性能兜底） */
  showGuides?: boolean
}) {
  const layout = useMemo(() => (showGuides && nodes.length ? buildGitLaneLayout(nodes) : null), [nodes, showGuides])

  return (
    <ul className={cn('w-full min-w-0', className)} role="tree">
      {nodes.map((n, index) => {
        const selected = selectedId === n.id
        return (
          <li key={n.id} className="min-w-0" role="treeitem" aria-level={n.depth + 1}>
            <button
              type="button"
              title={n.isLeaf ? '当前位置' : onActivate ? 'Enter 或双击跳转' : '跳转到此节点'}
              onClick={() => {
                onSelect?.(n.id)
                if (!n.isLeaf && onActivate) onActivate(n.id)
              }}
              onDoubleClick={() => !n.isLeaf && onActivate?.(n.id)}
              className={cn(
                'flex w-full min-w-0 max-w-full items-stretch gap-0 rounded-md py-0.5 pr-2 text-left transition-colors',
                selected && 'bg-primary/12 ring-1 ring-inset ring-primary/30',
                !selected && 'hover:bg-muted/70',
                n.isLeaf && !selected && 'bg-primary/6 font-medium',
                rowClassName,
              )}
            >
              {layout && <SessionTreeGraphColumn index={index} nodes={nodes} layout={layout} />}
              <span
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-1.5 pl-1.5',
                  layout && !layout.pathIds.has(n.id) && !n.isLeaf && 'opacity-[0.72]',
                )}
              >
                {(() => {
                  const Icon = nodeIcon(n)
                  return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                })()}
                <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-foreground-secondary" title={sessionTreeLineTitle(n)}>
                  {sessionTreeLineTitle(n)}
                  {n.isLeaf && (
                    <span className="ml-1.5 whitespace-nowrap text-[10px] text-primary">← 当前</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}