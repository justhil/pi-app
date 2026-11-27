import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  useAnchoredMenuPosition,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'
import type { AdbDeviceInfo, CanvasSurface, CanvasSurfaceKind } from '@shared/canvas-types'
import { CANVAS_TOOL_DEFS } from '@shared/canvas-tools'
import {
  Boxes,
  Columns2,
  FileCode2,
  FileText,
  GitFork,
  Image as ImageIcon,
  Layers,
  Maximize2,
  MoreHorizontal,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from '@renderer/components/icons'
import { SessionPinGlyph } from '@renderer/lib/pinned-sessions'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  selectHiddenSessionCount,
  selectVisibleSurfaces,
  useCanvasStore,
} from './canvas-store'
import { DeviceStreamSurface } from './surfaces/device-stream-surface'
import { DelegationTreeSurface } from './surfaces/delegation-tree-surface'
import { SandboxHtmlSurface } from './surfaces/sandbox-html-surface'
import { DiagramSurface, MarkdownSurface, UiBlockSurface } from './surfaces/ui-block-surface'
import { ImageSurface } from './surfaces/image-surface'

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
    case 'image':
      return <ImageIcon className={className} />
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
    case 'image':
      return <ImageSurface surface={surface} />
    default:
      return null
  }
}

export function CanvasPanel() {
  const allSurfaces = useCanvasStore((s) => s.surfaces)
  const activeSurfaceId = useCanvasStore((s) => s.activeSurfaceId)
  const layoutMode = useCanvasStore((s) => s.layoutMode)
  const showAllSessions = useCanvasStore((s) => s.showAllSessions)
  const protocolDrawerOpen = useCanvasStore((s) => s.protocolDrawerOpen)
  const presentSurface = useCanvasStore((s) => s.presentSurface)
  const selectSurface = useCanvasStore((s) => s.selectSurface)
  const removeSurface = useCanvasStore((s) => s.removeSurface)
  const togglePinSurface = useCanvasStore((s) => s.togglePinSurface)
  const setLayoutMode = useCanvasStore((s) => s.setLayoutMode)
  const setShowAllSessions = useCanvasStore((s) => s.setShowAllSessions)
  const setProtocolDrawerOpen = useCanvasStore((s) => s.setProtocolDrawerOpen)
  const clearNonPinned = useCanvasStore((s) => s.clearNonPinned)

  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const stageExpand = useUIStore((s) => s.canvasChatExpand)
  const canvasHeaderMode = useUIStore((s) => s.uiCustomization.shellCanvasHeaderMode)

  const surfaces = useMemo(
    () => selectVisibleSurfaces(allSurfaces, historySessionFile, showAllSessions),
    [allSurfaces, historySessionFile, showAllSessions],
  )
  const hiddenOtherSessionCount = useMemo(
    () => selectHiddenSessionCount(allSurfaces, historySessionFile),
    [allSurfaces, historySessionFile],
  )

  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [adbScanning, setAdbScanning] = useState(false)
  const [adbPickerDevices, setAdbPickerDevices] = useState<AdbDeviceInfo[] | null>(null)
  const [adbScanError, setAdbScanError] = useState<string | null>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  useDismissContextMenu(moreMenuOpen, moreMenuRef, () => setMoreMenuOpen(false), moreBtnRef)
  const moreMenuPos = useAnchoredMenuPosition(moreMenuOpen, moreBtnRef, moreMenuRef, { align: 'end', gap: 6 })

  const activeSurface = surfaces.find((s) => s.id === activeSurfaceId) ?? surfaces[0] ?? null
  const showCanvasHeader =
    surfaces.length > 0 &&
    (canvasHeaderMode === 'always' ||
      (canvasHeaderMode === 'multi-only' &&
        (surfaces.length > 1 || layoutMode === 'grid' || protocolDrawerOpen || hiddenOtherSessionCount > 0 || showAllSessions)))

  const mountLiveDelegationTree = () => {
    presentSurface({
      id: 'live-delegation-tree',
      title: '实时委派树',
      kind: 'delegation-tree',
      payload: { source: 'live', title: '实时委派树' },
      source: 'user',
      sessionFile: historySessionFile ?? null,
      focus: true,
    })
    setMoreMenuOpen(false)
  }

  const mountAdbDevice = (device: AdbDeviceInfo) => {
    presentSurface({
      id: `adb-${device.serial}`,
      title: device.model || device.serial,
      subtitle: device.serial,
      kind: 'device-stream',
      payload: {
        deviceName: device.model || device.serial,
        serial: device.serial,
        platform: 'android',
        resolution: device.resolution ?? { width: 1080, height: 2400 },
        streamMode: 'adb-screencap',
        autoStream: true,
        controlMode: 'control',
        battery: device.battery,
        activeApp: device.activeApp,
        status: 'connecting',
      },
      source: 'user',
      pinned: true,
      sessionFile: historySessionFile ?? null,
      focus: true,
    })
    setAdbPickerDevices(null)
    setAdbScanError(null)
  }

  const scanAndConnectAdb = async () => {
    setMoreMenuOpen(false)
    setAdbScanning(true)
    setAdbScanError(null)
    try {
      const res = await ipcClient.invoke('canvas.adb.listDevices', {})
      if (!res?.ok) {
        const msg =
          res?.error === 'adb_not_found'
            ? '未检测到本机 adb 命令，请先安装 Android Platform-Tools 并加入 PATH。'
            : String(res?.error || 'ADB 设备扫描失败')
        setAdbScanError(msg)
        toast.error(msg)
        return
      }
      const online = ((res.devices ?? []) as AdbDeviceInfo[]).filter((d) => d.state === 'device')
      if (online.length === 0) {
        const msg = '未发现在线 ADB 设备，请检查 USB 调试授权或无线调试连接。'
        setAdbScanError(msg)
        toast.message(msg)
        return
      }
      if (online.length === 1) {
        mountAdbDevice(online[0])
        return
      }
      setAdbPickerDevices(online)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setAdbScanError(msg)
      toast.error(msg)
    } finally {
      setAdbScanning(false)
    }
  }

  const renderOverflowMenu = () => (
    <div className="relative">
      <button
        ref={moreBtnRef}
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
      {moreMenuOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={moreMenuRef}
              role="menu"
              data-browser-overlay=""
              style={moreMenuPos}
              onPointerDown={(e) => e.stopPropagation()}
              className="electron-no-drag fixed z-[500] w-[206px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border/65 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={mountLiveDelegationTree}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              >
                <GitFork className="h-3.5 w-3.5 text-foreground-secondary" />
                <span>挂载实时委派树</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void scanAndConnectAdb()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              >
                <Smartphone className="h-3.5 w-3.5 text-foreground-secondary" />
                <span>连接本地 ADB 设备</span>
              </button>
              <div className="my-1 h-px bg-border/45" />
              {surfaces.length > 0 ? (
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
              ) : null}
              {hiddenOtherSessionCount > 0 || showAllSessions ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowAllSessions(!showAllSessions)
                    setMoreMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                >
                  <Layers className="h-3.5 w-3.5 text-foreground-secondary" />
                  <span>
                    {showAllSessions
                      ? '仅看当前会话画布'
                      : `显示全部会话 (+${hiddenOtherSessionCount})`}
                  </span>
                </button>
              ) : null}
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
              {surfaces.length > 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    clearNonPinned(showAllSessions ? undefined : (historySessionFile ?? null))
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>清空临时视图</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
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
                    'group flex h-6 max-w-[186px] shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-[11.5px] transition-colors',
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
                    aria-label={item.pinned ? `取消置顶 ${item.title}` : `置顶 ${item.title}`}
                    aria-pressed={Boolean(item.pinned)}
                    title={item.pinned ? '已置顶（跨会话保留）' : '置顶（跨会话保留）'}
                    onClick={() => togglePinSurface(item.id)}
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-foreground/[0.08]',
                      item.pinned
                        ? 'text-[var(--brand)] opacity-90'
                        : 'opacity-0 group-hover:opacity-55 hover:!opacity-100',
                    )}
                  >
                    <SessionPinGlyph className="h-2.5 w-2.5" filled={Boolean(item.pinned)} />
                  </button>
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

          {/* Quiet right controls: other-sessions toggle + independent expand + overflow menu */}
          <div className="flex shrink-0 items-center gap-0.5">
            {hiddenOtherSessionCount > 0 || showAllSessions ? (
              <button
                type="button"
                onClick={() => setShowAllSessions(!showAllSessions)}
                title={showAllSessions ? '仅看当前会话' : `显示其他会话的 ${hiddenOtherSessionCount} 个画布`}
                className={cn(
                  'h-6 rounded-md px-1.5 text-[10.5px] tabular-nums transition-colors',
                  showAllSessions
                    ? 'bg-foreground/[0.08] font-medium text-foreground'
                    : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
                )}
              >
                {showAllSessions ? '全部' : `+${hiddenOtherSessionCount}`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                useUIStore.setState((s) => ({
                  canvasChatExpand: !s.canvasChatExpand,
                  browserChatExpand: false,
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
      ) : surfaces.length > 0 ? (
        <div
          className={cn(
            'absolute right-2.5 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/85 p-0.5 shadow-sm backdrop-blur-sm transition-opacity',
            moreMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/canvas:opacity-100',
          )}
        >
          {renderOverflowMenu()}
        </div>
      ) : null}

      {/* Optional developer protocol drawer */}
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

      {/* Inline multi-device ADB picker when >1 Android devices are connected */}
      {adbPickerDevices && adbPickerDevices.length > 0 ? (
        <div className="shrink-0 border-b border-border/35 bg-[var(--bg-1)]/70 px-3.5 py-2.5 text-[11.5px]">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">选择要投屏的 ADB 设备</span>
            <button
              type="button"
              onClick={() => setAdbPickerDevices(null)}
              className="text-[11px] text-foreground-secondary hover:text-foreground"
            >
              取消
            </button>
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {adbPickerDevices.map((dev) => (
              <button
                key={dev.serial}
                type="button"
                onClick={() => mountAdbDevice(dev)}
                className="flex items-center justify-between rounded-lg border border-border/45 bg-background px-2.5 py-1.5 text-left hover:border-foreground/25"
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Smartphone className="h-3.5 w-3.5 text-emerald-500" />
                  <span>{dev.model || dev.serial}</span>
                </span>
                <span className="font-mono text-[10.5px] text-foreground-secondary">
                  {dev.serial}
                  {dev.resolution ? ` · ${dev.resolution.width}×${dev.resolution.height}` : ''}
                </span>
              </button>
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
              <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-foreground-secondary">
                对话中 Agent 投射的设备画面、任务拓扑、图表、图片和原型会按会话呈现在这里，也可直接零 Token 手动挂载。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={mountLiveDelegationTree}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/55 bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)]"
              >
                <GitFork className="h-3.5 w-3.5 text-foreground-secondary" />
                <span>实时委派树</span>
              </button>
              <button
                type="button"
                disabled={adbScanning}
                onClick={() => void scanAndConnectAdb()}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/55 bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {adbScanning ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-foreground-secondary" />
                ) : (
                  <Smartphone className="h-3.5 w-3.5 text-foreground-secondary" />
                )}
                <span>连接 ADB 手机</span>
              </button>
              <button
                type="button"
                onClick={() => setProtocolDrawerOpen(!protocolDrawerOpen)}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/45 bg-transparent px-2.5 text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <Wrench className="h-3 w-3" />
                <span>工具协议</span>
              </button>
            </div>
            {hiddenOtherSessionCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllSessions(true)}
                className="text-[11.5px] text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline"
              >
                查看其他会话中的 {hiddenOtherSessionCount} 个画布
              </button>
            ) : null}
            {adbScanError ? (
              <p className="max-w-[300px] text-[11px] leading-relaxed text-destructive/90">{adbScanError}</p>
            ) : null}
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
