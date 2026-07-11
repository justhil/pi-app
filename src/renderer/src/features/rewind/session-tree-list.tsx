import { Bot, GitBranch, MessageSquare, Sparkles, Wrench } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
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

function nodeIconClass(n: SessionTreeNode): string {
  if (n.entryType === 'message' && n.role === 'user') return 'text-sky-600/75 dark:text-sky-400/75'
  if (n.entryType === 'message' && n.role === 'assistant') return 'text-[var(--brand)]/80'
  if (n.entryType === 'compaction' || n.entryType === 'branch_summary') {
    return 'text-violet-600/70 dark:text-violet-400/70'
  }
  if (n.entryType.includes('tool') || n.entryType === 'tool') {
    return 'text-amber-700/70 dark:text-amber-400/70'
  }
  return 'text-muted-foreground/70'
}

export function SessionTreeList({
  nodes,
  selectedId,
  onSelect,
  onActivate,
  className,
  rowClassName,
  showGuides = true,
  renderTrailing,
}: {
  nodes: SessionTreeNode[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  className?: string
  rowClassName?: string
  /** false：仅文本列表（大树性能兜底） */
  showGuides?: boolean
  /** Optional trailing control per row (e.g. Fork on user messages) */
  renderTrailing?: (node: SessionTreeNode) => ReactNode
}) {
  const layout = useMemo(
    () => (showGuides && nodes.length ? buildGitLaneLayout(nodes) : null),
    [nodes, showGuides],
  )

  return (
    <ul className={cn('w-full min-w-0', className)} role="tree">
      {nodes.map((n, index) => {
        const selected = selectedId === n.id
        const trailing = renderTrailing?.(n)
        return (
          <li key={n.id} className="group/tree-row min-w-0" role="treeitem" aria-level={n.depth + 1}>
            <div
              className={cn(
                'flex w-full min-w-0 max-w-full items-stretch gap-0 rounded-md transition-colors',
                selected && 'bg-primary/12 ring-1 ring-inset ring-primary/30',
                !selected && 'hover:bg-muted/70',
                n.isLeaf && !selected && 'bg-primary/6',
              )}
            >
              <button
                type="button"
                title={n.isLeaf ? '当前位置' : onActivate ? 'Enter 或双击跳转' : '跳转到此节点'}
                onClick={() => {
                  onSelect?.(n.id)
                  if (!n.isLeaf && onActivate) onActivate(n.id)
                }}
                onDoubleClick={() => !n.isLeaf && onActivate?.(n.id)}
                className={cn(
                  'flex min-w-0 flex-1 items-stretch gap-0 py-0.5 pl-0 pr-1 text-left',
                  n.isLeaf && 'font-medium',
                  rowClassName,
                )}
              >
                {layout && <SessionTreeGraphColumn index={index} nodes={nodes} layout={layout} />}
                <span
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 pl-1.5',
                    layout && !layout.pathIds.has(n.id) && !n.isLeaf && 'opacity-[0.72]',
                  )}
                >
                  {(() => {
                    const Icon = nodeIcon(n)
                    return (
                      <Icon
                        className={cn('h-3.5 w-3.5 shrink-0 opacity-80', nodeIconClass(n))}
                      />
                    )
                  })()}
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] leading-[26px] text-foreground-secondary"
                    title={sessionTreeLineTitle(n)}
                  >
                    {sessionTreeLineTitle(n)}
                    {n.isLeaf && (
                      <span className="ml-1.5 whitespace-nowrap text-[10px] text-primary">← 当前</span>
                    )}
                  </span>
                </span>
              </button>
              {trailing != null && (
                <div className="flex shrink-0 items-center pr-0.5 opacity-0 transition-opacity group-hover/tree-row:opacity-100 focus-within:opacity-100">
                  {trailing}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
