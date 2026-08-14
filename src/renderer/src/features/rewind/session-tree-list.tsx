import { ArrowLeft, Bot, GitBranch, MessageSquare, Sparkles, Wrench } from '@renderer/components/icons'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
    const p = (n.preview || '').replace(/\s+/g, ' ').trim()
    if (p) return p.length > 120 ? `${p.slice(0, 120)}…` : p
    if (n.role === 'user') return '用户'
    if (n.role === 'assistant') return '助手'
    return '消息'
  }
  if (n.entryType === 'compaction') return '压缩'
  if (n.entryType === 'branch_summary') return '分支摘要'
  if (n.entryType === 'thinking_level_change') return '思考档位'
  if (n.entryType === 'model_change') return '模型'
  return n.entryType
}

export type TreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all'

export const TREE_FILTER_OPTS: { key: TreeFilterMode; label: string }[] = [
  { key: 'default', label: '对话' },
  { key: 'user-only', label: '仅用户' },
  { key: 'all', label: '全部' },
]

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

/** 时间线里能直接落点的树条目：user/assistant/system 消息。 */
function isLandableViewTarget(n: SessionTreeNode): boolean {
  if (n.entryType !== 'message') return false
  // toolResult 的 entryType 也是 message，但时间线把它的输出合并进前一条
  // assistant 工具行，不生成该 entry id 的锚点——单击/Enter 跳过去无法落点
  return n.role !== 'toolResult'
}

/**
 * Non-message tree entries (tool / compaction / branch_summary / labels / toolResult)
 * have no 1:1 timeline row, so a view jump lands on the nearest message instead:
 * prefer the next one (the reply that used this entry), fall back to the previous one.
 */
export function resolveViewTargetId(nodes: SessionTreeNode[], index: number): string {
  const node = nodes[index]
  if (!node) return ''
  if (isLandableViewTarget(node)) return node.id
  // toolResult 是前一条 assistant 工具行的输出（已合并进该行），优先回退到它；
  // 其它元条目优先找“使用该条目的下一条消息”。
  const preferNext = node.role !== 'toolResult'
  if (preferNext) {
    for (let i = index + 1; i < nodes.length; i++) {
      if (isLandableViewTarget(nodes[i])) return nodes[i].id
    }
  }
  for (let i = index - 1; i >= 0; i--) {
    if (isLandableViewTarget(nodes[i])) return nodes[i].id
  }
  if (!preferNext) {
    for (let i = index + 1; i < nodes.length; i++) {
      if (isLandableViewTarget(nodes[i])) return nodes[i].id
    }
  }
  return node.id
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
  viewOnSingleClick = false,
  onView,
}: {
  nodes: SessionTreeNode[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onActivate?: (id: string) => void
  /** Non-destructive view jump: single click scrolls the timeline to the node's message. */
  onView?: (id: string) => void
  className?: string
  rowClassName?: string
  /** false：仅文本列表（大树性能兜底） */
  showGuides?: boolean
  /** Optional trailing control per row (e.g. Fork on user messages) */
  renderTrailing?: (node: SessionTreeNode) => ReactNode
  /** true: single click on a non-leaf row views it (no rewind); double-click rewinds. */
  viewOnSingleClick?: boolean
}) {
  const { t } = useTranslation()
  const layout = useMemo(
    () => (showGuides && nodes.length ? buildGitLaneLayout(nodes) : null),
    [nodes, showGuides],
  )

  // Debounces single-click view jumps so the second click of a double-click
  // cancels the pending jump instead of firing a view before the rewind.
  const viewTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (viewTimer.current) window.clearTimeout(viewTimer.current)
    },
    [],
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
                title={
                  n.isLeaf
                    ? '当前位置'
                    : onActivate
                      ? t('timeline:treeViewNode')
                      : t('timeline:jumpToNode')
                }
                onClick={() => {
                  onSelect?.(n.id)
                  if (!viewOnSingleClick || n.isLeaf || !onView) return
                  if (viewTimer.current) window.clearTimeout(viewTimer.current)
                  viewTimer.current = window.setTimeout(() => {
                    viewTimer.current = null
                    onView(resolveViewTargetId(nodes, index))
                  }, 250)
                }}
                onDoubleClick={() => {
                  if (n.isLeaf || !onActivate) return
                  if (viewTimer.current) {
                    window.clearTimeout(viewTimer.current)
                    viewTimer.current = null
                  }
                  onActivate(n.id)
                }}
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
                      <span className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] text-primary">
                        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
                        当前
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {trailing != null && (
                <div className="flex shrink-0 items-center pr-0.5 transition-opacity">
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
