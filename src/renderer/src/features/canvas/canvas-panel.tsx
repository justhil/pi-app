import { useState } from 'react'
import { toast } from 'sonner'
import type { CanvasSurface, CanvasSurfaceKind } from '@shared/canvas-types'
import { CANVAS_TOOL_DEFS } from '@shared/canvas-tools'
import {
  Boxes,
  Columns2,
  FileCode2,
  FileText,
  GitFork,
  Layers,
  Maximize2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  createMermaidDemoSurface,
  createStatGridDemoSurface,
  useCanvasStore,
} from './canvas-store'
import { DeviceStreamSurface } from './surfaces/device-stream-surface'
import { DelegationTreeSurface } from './surfaces/delegation-tree-surface'
import { SandboxHtmlSurface } from './surfaces/sandbox-html-surface'
import { DiagramSurface, MarkdownSurface, UiBlockSurface } from './surfaces/ui-block-surface'

function SurfaceKindIcon({ kind, className }: { kind: CanvasSurfaceKind; className?: string }) {
  switch (kind) {
    case 'device-stream':
      return <Smartphone className={className} />
    case 'delegation-tree':
      return <GitFork className={className} />
    case 'ui-block':
      return <Sparkles className={className} />
    case 'html':
      return <FileCode2 className={className} />
    case 'diagram':
      return <Boxes className={className} />
    default:
      return <FileText className={className} />
  }
}

function SurfaceBody({ surface }: { surface: CanvasSurface }) {
  switch (surface.kind) {
    case 'device-stream':
      return <DeviceStreamSurface surface={surface} />
    case 'delegation-tree':
      return <DelegationTreeSurface surface={surface} />
    case 'ui-block':
      return <UiBlockSurface surface={surface} />
    case 'html':
      return <SandboxHtmlSurface surface={surface} />
    case 'diagram':
      return <DiagramSurface surface={surface} />
    case 'markdown':
      return <MarkdownSurface surface={surface} />
    default:
      return null
  }
}

export function CanvasPanel() {
  const surfaces = useCanvasStore((s) => s.surfaces)
  const activeSurfaceId = useCanvasStore((s) => s.activeSurfaceId)
  const layoutMode = useCanvasStore((s) => s.layoutMode)
  const protocolDrawerOpen = useCanvasStore((s) => s.protocolDrawerOpen)
  const selectSurface = useCanvasStore((s) => s.selectSurface)
  const removeSurface = useCanvasStore((s) => s.removeSurface)
  const setLayoutMode = useCanvasStore((s) => s.setLayoutMode)
  const setProtocolDrawerOpen = useCanvasStore((s) => s.setProtocolDrawerOpen)
  const presentSurface = useCanvasStore((s) => s.presentSurface)
  const clearNonPinned = useCanvasStore((s) => s.clearNonPinned)
  const restoreDemos = useCanvasStore((s) => s.restoreDemos)

  const stageExpand = useUIStore((s) => s.browserChatExpand)
  const canvasHeaderMode = useUIStore((s) => s.uiCustomization.shellCanvasHeaderMode)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const activeSurface =
    surfaces.find((s) => s.id === activeSurfaceId) ?? surfaces[0] ?? null
  const showCanvasHeader =
    canvasHeaderMode === 'always' ||
    (canvasHeaderMode === 'multi-only' &&
      (surfaces.length > 1 || layoutMode === 'grid' || protocolDrawerOpen))

  const projectMermaidDemo = () => {
    const item = createMermaidDemoSurface()
    presentSurface({ ...item, focus: true })
    setLayoutMode('single')
    setMoreMenuOpen(false)
    toast.success('已添加系统架构图')
  }

  const projectKpiDemo = () => {
    const item = createStatGridDemoSurface()
    presentSurface({ ...item, focus: true })
    setLayoutMode('single')
    setMoreMenuOpen(false)
    toast.success('已添加性能指标视图')
  }

  const projectSampleTable = () => {
    const now = Date.now()
    presentSurface({
      id: `live-table-${now.toString(36).slice(-4)}`,
      title: '节点状态总览',
      subtitle: '实时运行指标',
      kind: 'ui-block',
      source: 'ai',
      focus: true,
      payload: {
        component: 'data-table',
        props: {
          title: '连接设备与运行节点',
          columns: [
            { key: 'target', label: '节点' },
            { key: 'channel', label: '通道' },
            { key: 'latency', label: '延迟 (ms)', type: 'number' },
            { key: 'status', label: '状态' },
          ],
          rows: [
            { target: 'Pixel 9 Pro (emulator-5554)', channel: 'ADB Stream', latency: 18, status: '就绪' },
            { target: 'adb-bridge', channel: 'Worker', latency: 4, status: '运行中' },
            { target: 'ui-architect', channel: 'Worker', latency: 3, status: '已完成' },
            { target: '参数面板', channel: 'Interactive', latency: 1, status: '活跃' },
          ],
          pageSize: 10,
        },
      },
    })
    setLayoutMode('single')
    setProtocolDrawerOpen(false)
    setMoreMenuOpen(false)
  }

  const renderOverflowMenu = () => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMoreMenuOpen((v) => !v)}
        aria-expanded={moreMenuOpen}
        title="画布选项"
        aria-label="画布选项"
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
          moreMenuOpen
            ? 'bg-foreground/[0.08] text-foreground'
            : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {moreMenuOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} aria-hidden />
          <div
            role="menu"
            data-browser-overlay=""
            className="shell-popover absolute right-0 top-7 z-50 w-[204px] rounded-lg border border-border/65 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLayoutMode(layoutMode === 'grid' ? 'single' : 'grid')
                setMoreMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <Columns2 className="h-3.5 w-3.5 text-foreground-secondary" />
              <span>{layoutMode === 'grid' ? '切回单视图' : '网格总览'}</span>
            </button>
            <div className="my-1 h-px bg-border/45" />
            <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground/75">添加视图</div>
            <button
              type="button"
              role="menuitem"
              onClick={projectKpiDemo}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <Sparkles className="h-3.5 w-3.5 text-foreground-secondary" />
              <span>核心指标卡片</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={projectMermaidDemo}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <Boxes className="h-3.5 w-3.5 text-foreground-secondary" />
              <span>系统架构图</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={projectSampleTable}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <Plus className="h-3.5 w-3.5 text-foreground-secondary" />
              <span>节点状态表格</span>
            </button>
            <div className="my-1 h-px bg-border/45" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProtocolDrawerOpen(!protocolDrawerOpen)
                setMoreMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>{protocolDrawerOpen ? '隐藏工具协议' : '工具协议说明'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreMenuOpen(false)
                restoreDemos()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>恢复默认视图</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreMenuOpen(false)
                clearNonPinned()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>清空临时视图</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  )

  return (
    <div data-pi-slot="ai-canvas-panel" className="group/canvas relative flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Lightweight single-plane switcher fused with panel background */}
      {showCanvasHeader ? (
        <div
          data-pi-slot="ai-canvas-tabs"
          className="flex h-9 shrink-0 items-center gap-1 bg-[var(--bg-base)] px-3"
        >
          <div
            className="right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            role="tablist"
            aria-label="画布视图"
          >
            {surfaces.map((item) => {
              const active = layoutMode === 'single' && activeSurface?.id === item.id
              return (
                <div
                  key={item.id}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault()
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    removeSurface(item.id)
                  }}
                  className={cn(
                    'group flex h-6 max-w-[164px] shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[11.5px] transition-colors',
                    active
                      ? 'bg-foreground/[0.06] font-medium text-foreground'
                      : 'text-foreground-secondary/80 hover:bg-foreground/[0.04] hover:text-foreground',
                  )}
                >
                  <SurfaceKindIcon kind={item.kind} className="h-3 w-3 shrink-0 opacity-70" />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      selectSurface(item.id)
                      if (layoutMode === 'grid') setLayoutMode('single')
                    }}
                    title={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {item.title}
                  </button>
                  {item.source === 'ai' ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    aria-label={`关闭 ${item.title}`}
                    onClick={() => removeSurface(item.id)}
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-foreground/[0.08]',
                      active ? 'opacity-45 hover:opacity-100' : 'opacity-0 group-hover:opacity-55 hover:!opacity-100',
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Quiet right controls: expand + overflow menu */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                useUIStore.setState((s) => ({
                  browserChatExpand: !s.browserChatExpand,
                  filesPreviewChatExpand: false,
                }))
              }
              aria-pressed={stageExpand}
              title={stageExpand ? '退出全宽' : '全宽查看'}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                stageExpand
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            {renderOverflowMenu()}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'absolute right-2.5 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/85 p-0.5 shadow-sm backdrop-blur-sm transition-opacity',
            moreMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/canvas:opacity-100',
          )}
        >
          {renderOverflowMenu()}
        </div>
      )}

      {/* Optional developer protocol drawer (hidden in overflow menu by default) */}
      {protocolDrawerOpen ? (
        <div className="shrink-0 border-b border-border/35 bg-[var(--bg-1)]/65 px-3.5 py-2.5 text-[11.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">AI 画布工具接口</span>
            <button
              type="button"
              onClick={() => setProtocolDrawerOpen(false)}
              className="text-[11px] text-foreground-secondary hover:text-foreground"
            >
              收起
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {CANVAS_TOOL_DEFS.map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg border border-border/35 bg-background/80 px-2.5 py-1.5"
              >
                <div className="font-mono text-[11px] font-medium text-foreground">{tool.name}</div>
                <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-foreground-secondary">
                  {tool.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Main Canvas Stage Content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {surfaces.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/45 bg-[var(--bg-1)] text-foreground-secondary">
              <Layers className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-foreground">画布为空</div>
              <p className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-foreground-secondary">
                启用画布工具后，Agent 生成的设备画面、任务拓扑、图表和原型会实时呈现在这里。
              </p>
            </div>
            <button
              type="button"
              onClick={restoreDemos}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/55 bg-background px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)]"
            >
              <RotateCcw className="h-3 w-3" />
              <span>载入示例视图</span>
            </button>
          </div>
        ) : layoutMode === 'grid' ? (
          <div className="grid h-full auto-rows-[minmax(220px,1fr)] grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-2">
            {surfaces.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'flex min-h-0 flex-col overflow-hidden rounded-xl border transition-colors',
                  activeSurface?.id === item.id
                    ? 'border-foreground/25'
                    : 'border-border/45 hover:border-border',
                )}
              >
                <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/30 bg-[var(--bg-1)]/45 px-2.5 text-[11.5px]">
                  <button
                    type="button"
                    onClick={() => {
                      selectSurface(item.id)
                      setLayoutMode('single')
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium text-foreground"
                  >
                    <SurfaceKindIcon kind={item.kind} className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{item.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      selectSurface(item.id)
                      setLayoutMode('single')
                    }}
                    className="text-[10.5px] text-foreground-secondary hover:text-foreground"
                  >
                    展开
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <SurfaceBody surface={item} />
                </div>
              </div>
            ))}
          </div>
        ) : activeSurface ? (
          <SurfaceBody surface={activeSurface} />
        ) : null}
      </div>
    </div>
  )
}
