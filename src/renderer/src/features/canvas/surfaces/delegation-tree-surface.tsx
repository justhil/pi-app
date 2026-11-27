import { useMemo, useState } from 'react'
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
  XCircle,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeTreeToolItem } from '@renderer/features/timeline/tree-tool-model'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { useCanvasStore } from '../canvas-store'

const DEMO_NODES: CanvasDelegationNode[] = [
  {
    id: 'root',
    parentId: null,
    agent: 'orchestrator',
    role: '主会话调度器',
    task: '重构左右侧边栏交互，并搭建右侧多模态 AI 画布',
    state: 'running',
    toolCount: 14,
    tokens: 31_400,
    durationMs: 42_000,
    model: 'claude-sonnet-5-5',
    outputPreview: '已分发 3 个并行子任务：布局打磨已完成，ADB 流协议桥接正在验证中。',
  },
  {
    id: 'n-ui',
    parentId: 'root',
    agent: 'ui-architect',
    role: '前端架构',
    task: '净化左栏底栏、修复行高并重做右侧舞台容器',
    state: 'completed',
    toolCount: 9,
    tokens: 14_200,
    durationMs: 18_400,
    model: 'claude-sonnet-5-5',
    outputPreview: '已完成 ImmersiveChrome 分段切换、贴边图标轨及浏览器嵌套层瘦身。',
  },
  {
    id: 'n-adb',
    parentId: 'root',
    agent: 'adb-bridge',
    role: '设备流代理',
    task: '建立 scrcpy / ADB 帧通道与触控坐标回传契约',
    state: 'running',
    toolCount: 12,
    tokens: 9_850,
    durationMs: 21_700,
    model: 'claude-sonnet-5-5',
    outputPreview: '正在监听 emulator-5554 (1080×2400)，已叠加 AI 视觉定位标靶…',
  },
  {
    id: 'n-qa',
    parentId: 'root',
    agent: 'qa-verifier',
    role: '验证回归',
    task: '等待上游完成后执行 typecheck、单测与 E2E 冒烟',
    state: 'pending',
    toolCount: 0,
    tokens: 0,
    durationMs: 0,
    model: 'claude-haiku-5-5',
    outputPreview: '等待 adb-bridge 结束后自动启动校验。',
  },
  {
    id: 'n-enc',
    parentId: 'n-adb',
    agent: 'frame-encoder',
    role: '子委派',
    task: '动态码率自适应与 WebCodecs 解码降级策略',
    state: 'running',
    toolCount: 4,
    tokens: 3_120,
    durationMs: 7_900,
    model: 'claude-haiku-5-5',
    outputPreview: '当前帧率稳定 60fps，端到端延迟 18ms。',
  },
]

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
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
        ring: 'border-border/55 bg-background',
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

export function DelegationTreeSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDelegationPayload
  const timelineItems = useUIStore((s) => s.timelineItems)
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)

  const [mode, setMode] = useState<'auto' | 'demo'>('auto')
  const [selectedId, setSelectedId] = useState<string>('n-adb')

  const liveNodes = useMemo<CanvasDelegationNode[]>(() => {
    if (payload.source === 'snapshot' && payload.nodes?.length) return payload.nodes
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
    if (treeItems.length === 0) return []
    const nodes: CanvasDelegationNode[] = [
      {
        id: 'session-root',
        parentId: null,
        agent: 'main-session',
        role: '当前会话',
        task: `共 ${treeItems.length} 组委派调用`,
        state: treeItems.some((i) => i.toolPhase === 'start' || i.toolPhase === 'update') ? 'running' : 'completed',
      },
    ]
    for (const item of treeItems) {
      const view = normalizeTreeToolItem(item)
      for (const child of view.children) {
        nodes.push({
          id: child.key,
          parentId: 'session-root',
          agent: child.agent,
          role: view.mode || 'subagent',
          task: child.task || child.agent,
          state: child.state,
          toolCount: child.toolCount,
          tokens: child.tokens,
          durationMs: child.durationMs,
          sessionFile: child.sessionFile,
          error: child.error,
        })
      }
    }
    return nodes
  }, [payload.nodes, payload.source, timelineItems])

  const usingDemo = mode === 'demo' || liveNodes.length === 0
  const nodes = usingDemo ? DEMO_NODES : liveNodes

  const childrenByParent = useMemo(() => {
    const map = new Map<string, CanvasDelegationNode[]>()
    for (const node of nodes) {
      const pid = node.parentId ?? '__root__'
      const list = map.get(pid) ?? []
      list.push(node)
      map.set(pid, list)
    }
    return map
  }, [nodes])

  const roots = childrenByParent.get('__root__') ?? nodes.slice(0, 1)
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? nodes[0] ?? null

  const counts = useMemo(() => {
    let running = 0
    let completed = 0
    let failed = 0
    for (const n of nodes) {
      if (n.state === 'running') running++
      else if (n.state === 'completed') completed++
      else if (n.state === 'failed') failed++
    }
    return { running, completed, failed }
  }, [nodes])

  const selectNode = (node: CanvasDelegationNode) => {
    setSelectedId(node.id)
    recordInteraction(surface.id, { selectedNodeId: node.id, selectedAgent: node.agent })
  }

  const renderBranch = (node: CanvasDelegationNode, depth = 0) => {
    const kids = childrenByParent.get(node.id) ?? []
    const badge = stateBadge(node.state)
    const active = selectedNode?.id === node.id
    return (
      <div key={node.id} className="relative">
        <button
          type="button"
          onClick={() => selectNode(node)}
          className={cn(
            'group relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
            badge.ring,
            active
              ? 'ring-2 ring-[var(--brand)]/55 shadow-sm'
              : 'hover:border-foreground/20 hover:bg-[var(--bg-hover)]/45',
          )}
        >
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-2)] text-foreground-secondary">
            {depth === 0 ? <GitFork className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
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
            <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[10px] text-foreground-secondary/75">
              {node.toolCount != null ? <span>{node.toolCount} tools</span> : null}
              {node.tokens ? <span>{formatTokens(node.tokens)} tok</span> : null}
              {node.durationMs ? <span>{formatDuration(node.durationMs)}</span> : null}
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Quiet Header summary */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3.5 text-[11.5px]">
        <div className="flex items-center gap-2.5">
          <span className="font-medium text-foreground">{payload.title || '委派执行树'}</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {counts.running}
          </span>
          <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-foreground-secondary">
            <CheckCircle2 className="h-3 w-3 opacity-70" />
            {counts.completed}
          </span>
          {counts.failed > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-destructive">
              <XCircle className="h-3 w-3" />
              {counts.failed}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === 'demo' ? 'auto' : 'demo')}
          className="text-[10.5px] text-foreground-secondary/70 transition-colors hover:text-foreground"
        >
          {usingDemo ? (liveNodes.length > 0 ? '切回实时' : '示例视图') : '实时同步'}
        </button>
      </div>

      {/* Tree Canvas */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5 pt-1">
        <div className="space-y-2.5">{roots.map((root) => renderBranch(root, 0))}</div>
      </div>

      {/* Node Inspector Footer */}
      {selectedNode ? (
        <div className="shrink-0 border-t border-border/40 bg-[var(--bg-1)]/70 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12px] font-semibold text-foreground">{selectedNode.agent}</span>
              <span className="inline-flex items-center gap-1 text-[10.5px] text-foreground-secondary">
                <Clock className="h-3 w-3" />
                {formatDuration(selectedNode.durationMs)}
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
