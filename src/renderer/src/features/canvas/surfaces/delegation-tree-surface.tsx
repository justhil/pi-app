import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  CanvasDelegationNode,
  CanvasDelegationNodeState,
  CanvasDelegationPayload,
  CanvasSurface,
} from '@shared/canvas-types'
import {
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitFork,
  Layers,
  MessageSquarePlus,
  XCircle,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem, TimelineItem } from '@renderer/stores/ui-store-types'
import { normalizeTreeToolItem } from '@renderer/features/timeline/tree-tool-model'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { quoteCanvasToComposer, useCanvasStore } from '../canvas-store'

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m${s}s`
}

function formatTokens(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function stateBadge(state: CanvasDelegationNodeState) {
  switch (state) {
    case 'running':
      return {
        label: '运行中',
        dot: 'bg-emerald-500 animate-pulse',
        ring: 'border-emerald-500/35 bg-background',
        text: 'text-emerald-600 dark:text-emerald-400',
      }
    case 'completed':
      return {
        label: '已完成',
        dot: 'bg-foreground-secondary/45',
        ring: 'border-border/45 bg-background',
        text: 'text-foreground-secondary',
      }
    case 'failed':
      return {
        label: '失败',
        dot: 'bg-destructive',
        ring: 'border-destructive/50 bg-destructive/[0.06]',
        text: 'text-destructive',
      }
    case 'pending':
      return {
        label: '等待中',
        dot: 'bg-amber-400',
        ring: 'border-border/50 border-dashed bg-transparent',
        text: 'text-amber-600 dark:text-amber-400',
      }
    default:
      return {
        label: state,
        dot: 'bg-foreground-secondary/50',
        ring: 'border-border/50 bg-[var(--bg-1)]/40',
        text: 'text-foreground-secondary',
      }
  }
}

/**
 * Build a multi-level delegation graph from live `timelineItems` (grouping parallel/chain batches)
 * and recursively attaching nested child subagent sessions via `parentSessionFile`.
 */
export function buildLiveDelegationNodes(
  timelineItems: readonly TimelineItem[],
  sessions: readonly SessionItem[],
  currentSessionFile?: string | null,
): CanvasDelegationNode[] {
  const treeItems = timelineItems.filter((item) => {
    if (item.type !== 'tool-call') return false
    const details = item.toolDetails as Record<string, unknown> | undefined
    const args = item.toolArgs as Record<string, unknown> | undefined
    return Boolean(
      details &&
        (Array.isArray(details.results) ||
          Array.isArray(details.progress) ||
          details.agent != null ||
          args?.tasks != null ||
          args?.chain != null),
    )
  })

  // Build parentSessionFile -> child SessionItem[] index for multi-level subagent discovery.
  const childSessionsByParent = new Map<string, SessionItem[]>()
  for (const sess of sessions) {
    if (!sess.parentSessionFile || !sess.sessionFile) continue
    const key = normalizeSessionFileKey(sess.parentSessionFile)
    if (!key) continue
    const list = childSessionsByParent.get(key) ?? []
    list.push(sess)
    childSessionsByParent.set(key, list)
  }

  const currentKey = currentSessionFile ? normalizeSessionFileKey(currentSessionFile) : ''
  const directDiskChildren = currentKey ? (childSessionsByParent.get(currentKey) ?? []) : []

  if (treeItems.length === 0 && directDiskChildren.length === 0) return []

  const list: CanvasDelegationNode[] = [
    {
      id: 'session-root',
      parentId: null,
      kind: 'session',
      agent: 'main-session',
      role: '当前会话',
      task:
        treeItems.length > 0
          ? `共 ${treeItems.length} 组委派调用`
          : `共 ${directDiskChildren.length} 个关联子会话`,
      state: treeItems.some((i) => i.toolPhase === 'start' || i.toolPhase === 'update')
        ? 'running'
        : 'completed',
      sessionFile: currentSessionFile || undefined,
    },
  ]

  const mountedSessionKeys = new Set<string>()
  if (currentKey) mountedSessionKeys.add(currentKey)

  const attachNestedSessionChildren = (parentNodeId: string, parentFile: string | undefined, depth: number) => {
    if (!parentFile || depth > 5) return
    const parentKey = normalizeSessionFileKey(parentFile)
    if (!parentKey) return
    const children = childSessionsByParent.get(parentKey)
    if (!children?.length) return
    for (const child of children) {
      if (!child.sessionFile) continue
      const childKey = normalizeSessionFileKey(child.sessionFile)
      if (!childKey || mountedSessionKeys.has(childKey)) continue
      mountedSessionKeys.add(childKey)
      const nodeId = `sess-${child.sessionId}`
      list.push({
        id: nodeId,
        parentId: parentNodeId,
        kind: 'agent',
        agent: child.title || child.sessionId.slice(0, 8),
        role: 'nested-subagent',
        task: child.firstMessage || child.title || '子会话任务',
        state: 'completed',
        sessionFile: child.sessionFile,
      })
      attachNestedSessionChildren(nodeId, child.sessionFile, depth + 1)
    }
  }

  const useBatchGroups = treeItems.length > 1
  treeItems.forEach((item, batchIdx) => {
    const view = normalizeTreeToolItem(item)
    const batchId = `batch-${item.toolCallId || item.id || batchIdx}`
    const isChain = view.mode === 'chain'
    let parentForChildren = 'session-root'

    if (useBatchGroups || isChain) {
      parentForChildren = batchId
      list.push({
        id: batchId,
        parentId: 'session-root',
        kind: 'batch',
        agent: isChain ? `串行链 #${batchIdx + 1}` : `并行批次 #${batchIdx + 1}`,
        role: view.mode || 'subagent',
        task: `${view.taskCount || view.children.length} 个子任务`,
        state: view.phase,
        startedAt: typeof item.timestamp === 'number' ? item.timestamp : undefined,
        activeTool: item.toolStatusLine || undefined,
      })
    }

    view.children.forEach((child, childIdx) => {
      const nodeId = `${batchId}:${child.key}`
      const childSessionKey = child.sessionFile ? normalizeSessionFileKey(child.sessionFile) : ''
      if (childSessionKey) mountedSessionKeys.add(childSessionKey)
      list.push({
        id: nodeId,
        parentId: parentForChildren,
        kind: isChain ? 'chain-step' : 'agent',
        stepIndex: isChain ? childIdx + 1 : undefined,
        agent: child.agent,
        role: isChain ? `步骤 ${childIdx + 1}` : (view.mode || 'subagent'),
        task: child.task || child.agent,
        state: child.state,
        toolCount: child.toolCount,
        tokens: child.tokens,
        durationMs: child.durationMs,
        startedAt:
          child.state === 'running' && typeof item.timestamp === 'number' ? item.timestamp : undefined,
        activeTool: child.state === 'running' ? item.toolStatusLine || undefined : undefined,
        sessionFile: child.sessionFile,
        error: child.error,
      })
      attachNestedSessionChildren(nodeId, child.sessionFile, 1)
    })
  })

  // Attach any disk-discovered direct subagent sessions not already matched by live timeline rows.
  attachNestedSessionChildren('session-root', currentSessionFile || undefined, 0)

  return list
}

type StateFilter = 'all' | 'running' | 'completed' | 'failed'

export function DelegationTreeSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDelegationPayload
  const timelineItems = useUIStore((s) => s.timelineItems)
  const sessions = useUIStore((s) => s.sessions)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)

  const [selectedId, setSelectedId] = useState<string>('')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [nowTick, setNowTick] = useState(() => Date.now())

  const nodes = useMemo<CanvasDelegationNode[]>(() => {
    if (payload.source === 'snapshot' && payload.nodes?.length) return payload.nodes
    return buildLiveDelegationNodes(timelineItems, sessions, historySessionFile)
  }, [payload.nodes, payload.source, timelineItems, sessions, historySessionFile])

  const counts = useMemo(() => {
    let running = 0
    let completed = 0
    let failed = 0
    for (const n of nodes) {
      if (n.kind === 'session' || n.kind === 'batch') continue
      if (n.state === 'running') running++
      else if (n.state === 'completed') completed++
      else if (n.state === 'failed') failed++
    }
    return { running, completed, failed }
  }, [nodes])

  // Live 1s elapsed timer ONLY while at least one node is actively running (zero idle timer cost).
  useEffect(() => {
    if (counts.running === 0) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [counts.running])

  const visibleIdSet = useMemo(() => {
    if (filter === 'all') return null
    const parentOf = new Map<string, string | null | undefined>()
    for (const n of nodes) parentOf.set(n.id, n.parentId)
    const keep = new Set<string>()
    for (const n of nodes) {
      if (n.state === filter) {
        let cur: string | null | undefined = n.id
        while (cur) {
          keep.add(cur)
          cur = parentOf.get(cur)
        }
      }
    }
    return keep
  }, [filter, nodes])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, CanvasDelegationNode[]>()
    for (const node of nodes) {
      if (visibleIdSet && !visibleIdSet.has(node.id)) continue
      const pid = node.parentId ?? '__root__'
      const list = map.get(pid) ?? []
      list.push(node)
      map.set(pid, list)
    }
    return map
  }, [nodes, visibleIdSet])

  const roots = childrenByParent.get('__root__') ?? (visibleIdSet ? [] : nodes.slice(0, 1))
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? nodes[0] ?? null

  const selectNode = (node: CanvasDelegationNode) => {
    setSelectedId(node.id)
    recordInteraction(surface.id, { selectedNodeId: node.id, selectedAgent: node.agent, state: node.state })
  }

  const quoteSelected = () => {
    if (!selectedNode) return
    const lines = [
      `[委派树节点 · ${selectedNode.agent}${selectedNode.role ? ` (${selectedNode.role})` : ''}]`,
      `状态: ${stateBadge(selectedNode.state).label}`,
      `任务: ${selectedNode.task}`,
    ]
    if (selectedNode.error) lines.push(`错误: ${selectedNode.error}`)
    else if (selectedNode.outputPreview) lines.push(`输出摘要: ${selectedNode.outputPreview}`)
    quoteCanvasToComposer(lines.join('\n'))
    toast.success('已引用委派节点到输入框')
  }

  const renderBranch = (node: CanvasDelegationNode, depth = 0) => {
    const kids = childrenByParent.get(node.id) ?? []
    const badge = stateBadge(node.state)
    const active = selectedNode?.id === node.id
    const liveDuration =
      node.durationMs ??
      (node.state === 'running' && node.startedAt ? Math.max(0, nowTick - node.startedAt) : undefined)

    return (
      <div key={node.id} className="relative">
        <button
          type="button"
          onClick={() => selectNode(node)}
          className={cn(
            'group relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-all',
            badge.ring,
            active
              ? 'ring-2 ring-[var(--brand)]/55 shadow-sm'
              : 'hover:border-foreground/20 hover:bg-[var(--bg-hover)]/45',
          )}
        >
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-2)] text-foreground-secondary">
            {node.kind === 'session' || depth === 0 ? (
              <GitFork className="h-3.5 w-3.5" />
            ) : node.kind === 'batch' ? (
              <Layers className="h-3.5 w-3.5" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {node.stepIndex != null ? (
                <span className="rounded bg-[var(--brand)]/15 px-1 py-0.5 font-mono text-[9.5px] font-semibold text-[var(--brand)]">
                  #{node.stepIndex}
                </span>
              ) : null}
              <span className="truncate text-[12.5px] font-semibold text-foreground">{node.agent}</span>
              {node.role ? (
                <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-foreground-secondary">
                  {node.role}
                </span>
              ) : null}
              <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium', badge.text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', badge.dot)} />
                {badge.label}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-foreground-secondary">{node.task}</p>
            {node.activeTool ? (
              <p className="mt-1 truncate font-mono text-[10px] text-emerald-600/85 dark:text-emerald-400/85">
                ▸ {node.activeTool}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[10px] text-foreground-secondary/75">
              {node.toolCount != null ? <span>{node.toolCount} tools</span> : null}
              {node.tokens ? <span>{formatTokens(node.tokens)} tok</span> : null}
              {liveDuration ? <span>{formatDuration(liveDuration)}</span> : null}
              {node.model ? <span className="truncate opacity-75">{node.model}</span> : null}
            </div>
          </div>
        </button>

        {kids.length > 0 ? (
          <div className="relative ml-5 mt-2 space-y-2 border-l border-border/60 pl-4">
            {kids.map((child) => (
              <div key={child.id} className="relative">
                <span
                  className="pointer-events-none absolute -left-4 top-5 h-px w-4 bg-border/60"
                  aria-hidden
                />
                {renderBranch(child, depth + 1)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Header summary + state filters */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground">{payload.title || '委派执行树'}</span>
          {nodes.length > 0 ? (
            <div className="flex items-center gap-0.5 text-[10.5px]">
              {(
                [
                  { id: 'all', label: '全部', count: null },
                  { id: 'running', label: '运行', count: counts.running },
                  { id: 'completed', label: '完成', count: counts.completed },
                  { id: 'failed', label: '失败', count: counts.failed },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 tabular-nums transition-colors',
                    filter === tab.id
                      ? 'bg-foreground/[0.08] font-medium text-foreground'
                      : 'text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground',
                  )}
                >
                  {tab.id === 'running' ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
                  {tab.id === 'completed' ? <CheckCircle2 className="h-2.5 w-2.5 opacity-70" /> : null}
                  {tab.id === 'failed' ? <XCircle className="h-2.5 w-2.5 text-destructive" /> : null}
                  <span>{tab.label}</span>
                  {tab.count != null ? <span className="opacity-75">{tab.count}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {selectedNode ? (
          <button
            type="button"
            onClick={quoteSelected}
            title="引用选中节点到对话"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        ) : null}
      </div>

      {/* Tree Canvas */}
      {nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[12px] text-foreground-secondary">
          当前会话暂无子代理委派任务
        </div>
      ) : roots.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[12px] text-foreground-secondary">
          该状态下暂无匹配节点
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5 pt-2.5">
          <div className="space-y-2.5">{roots.map((root) => renderBranch(root, 0))}</div>
        </div>
      )}

      {/* Node Inspector Footer */}
      {selectedNode ? (
        <div className="shrink-0 border-t border-border/40 bg-[var(--bg-1)]/70 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12px] font-semibold text-foreground">{selectedNode.agent}</span>
              <span className="inline-flex items-center gap-1 text-[10.5px] text-foreground-secondary">
                <Clock className="h-3 w-3" />
                {formatDuration(
                  selectedNode.durationMs ??
                    (selectedNode.state === 'running' && selectedNode.startedAt
                      ? Math.max(0, nowTick - selectedNode.startedAt)
                      : undefined),
                )}
              </span>
            </div>
            {selectedNode.sessionFile ? (
              <button
                type="button"
                onClick={() => void openSubagentSessionPreview(selectedNode.sessionFile!)}
                className="inline-flex h-6 items-center gap-1 rounded-md bg-[var(--bg-2)] px-2 text-[11px] font-medium text-foreground hover:bg-[var(--bg-active)]"
              >
                <ExternalLink className="h-3 w-3" />
                <span>查看子会话</span>
              </button>
            ) : (
              <span className="font-mono text-[10px] text-foreground-secondary/65">node:{selectedNode.id}</span>
            )}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-secondary">
            {selectedNode.error || selectedNode.outputPreview || selectedNode.task}
          </p>
        </div>
      ) : null}
    </div>
  )
}
