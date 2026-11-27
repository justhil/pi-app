import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CanvasDevicePayload, CanvasOverlayMarker, CanvasSurface } from '@shared/canvas-types'
import {
  ArrowLeft,
  Circle,
  Eye,
  EyeOff,
  MessageSquarePlus,
  RefreshCw,
  Smartphone,
  Square,
  Target,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useCanvasStore } from '../canvas-store'

interface TapRipple {
  id: number
  rx: number
  ry: number
  px: number
  py: number
}

export function DeviceStreamSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDevicePayload
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)
  const updateSurface = useCanvasStore((s) => s.updateSurface)

  const screenRef = useRef<HTMLDivElement>(null)
  const [showMarkers, setShowMarkers] = useState(true)
  const [landscape, setLandscape] = useState(payload.orientation === 'landscape')
  const [ripples, setRipples] = useState<TapRipple[]>([])
  const [activeTab, setActiveTab] = useState<'shop' | 'orders' | 'logs'>('shop')
  const [lastCmd, setLastCmd] = useState(payload.lastAction || 'adb devices -l -> connected')
  const [count, setCount] = useState(2)

  const widthPx = landscape ? payload.resolution.height : payload.resolution.width
  const heightPx = landscape ? payload.resolution.width : payload.resolution.height
  const markers = showMarkers ? (payload.markers ?? []) : []

  const emitDeviceTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const px = Math.round(rx * widthPx)
    const py = Math.round(ry * heightPx)
    const cmd = `adb -s ${payload.serial} shell input tap ${px} ${py}`
    const id = Date.now()
    setRipples((prev) => [...prev.slice(-3), { id, rx, ry, px, py }])
    setLastCmd(cmd)
    recordInteraction(surface.id, {
      lastTap: { x: px, y: py, rx: Number(rx.toFixed(3)), ry: Number(ry.toFixed(3)), cmd },
    })
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((item) => item.id !== id))
    }, 900)
  }

  const sendKey = (keyName: string, keyCode: string) => {
    const cmd = `adb -s ${payload.serial} shell input keyevent ${keyCode}`
    setLastCmd(cmd)
    recordInteraction(surface.id, { lastKey: { keyName, keyCode, cmd } })
  }

  const simulateAiMarker = () => {
    const nx = Number((0.22 + Math.random() * 0.56).toFixed(2))
    const ny = Number((0.26 + Math.random() * 0.48).toFixed(2))
    const px = Math.round(nx * widthPx)
    const py = Math.round(ny * heightPx)
    const nextMarkers: CanvasOverlayMarker[] = [
      {
        id: `ai-box-${Date.now()}`,
        kind: 'box',
        x: Math.max(0.06, nx - 0.16),
        y: Math.max(0.08, ny - 0.05),
        w: 0.32,
        h: 0.1,
        unit: 'ratio',
        label: `AI 定位 (${px}, ${py})`,
      },
      {
        id: `ai-tap-${Date.now()}`,
        kind: 'tap',
        x: nx,
        y: ny,
        unit: 'ratio',
      },
    ]
    updateSurface(surface.id, {
      payloadPatch: {
        markers: nextMarkers,
        lastAction: `adb -s ${payload.serial} shell input tap ${px} ${py}`,
      },
    })
    setLastCmd(`AI 标注目标 -> tap (${px}, ${py})`)
    setShowMarkers(true)
  }

  const attachContextToComposer = () => {
    const summary = `[ADB 设备画面 · ${payload.deviceName} (${payload.serial})]\n分辨率: ${widthPx}×${heightPx} · 当前应用: ${payload.activeApp || 'unknown'}\n最近操作: ${lastCmd}`
    window.dispatchEvent(
      new CustomEvent('pi-desktop:composer-attach-files', {
        detail: { files: [], text: summary },
      }),
    )
    toast.success('已将设备上下文插入输入框')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Minimal Device Status & Action Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                payload.status === 'connected'
                  ? 'bg-emerald-500'
                  : payload.status === 'mock'
                    ? 'bg-[var(--brand)]'
                    : 'bg-amber-500',
              )}
            />
            <span className="truncate">{payload.deviceName}</span>
          </span>
          <span className="hidden font-mono text-[10.5px] text-foreground-secondary/65 sm:inline">
            {payload.serial}
          </span>
          <span className="hidden text-[10.5px] tabular-nums text-foreground-secondary/55 md:inline">
            {widthPx}×{heightPx} · {payload.fps ?? 60}fps
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setShowMarkers((v) => !v)}
            title={showMarkers ? '隐藏视觉标注' : '显示视觉标注'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              showMarkers
                ? 'bg-foreground/[0.07] text-foreground'
                : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            {showMarkers ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={simulateAiMarker}
            title="定位标注"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Target className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLandscape((v) => !v)}
            title="旋转屏幕"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={attachContextToComposer}
            title="将设备上下文发送到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {/* Device Viewport Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />

        <div
          className={cn(
            'relative flex flex-col overflow-hidden rounded-[28px] border-[3px] border-foreground/15 bg-[#0f1117] p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.45)] transition-all duration-300',
            landscape ? 'aspect-[19.5/9.5] w-full max-w-[540px]' : 'aspect-[9/19.2] h-full max-h-[560px] min-h-[380px]',
          )}
        >
          {/* Phone Inner Screen */}
          <div
            ref={screenRef}
            onClick={emitDeviceTap}
            className="relative flex min-h-0 flex-1 cursor-crosshair select-none flex-col overflow-hidden rounded-[20px] bg-gradient-to-b from-[#171923] via-[#12151f] to-[#0e1018] text-slate-100"
          >
            {payload.frameDataUrl ? (
              <img
                src={payload.frameDataUrl}
                alt={payload.deviceName}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <>
                {/* Android Status Bar */}
                <div className="flex h-7 shrink-0 items-center justify-between px-4 text-[10px] font-medium text-slate-300/90">
                  <span>09:41</span>
                  <div className="h-2.5 w-2.5 rounded-full bg-black/80 ring-1 ring-white/10" />
                  <div className="flex items-center gap-1.5">
                    <span>5G</span>
                    <span>{payload.battery ?? 87}%</span>
                  </div>
                </div>

                {/* Mock App Header */}
                <div className="flex items-center justify-between px-3.5 pb-2 pt-1">
                  <div>
                    <div className="text-[12px] font-semibold tracking-tight text-white">Checkout Flow</div>
                    <div className="font-mono text-[9.5px] text-slate-400">
                      {payload.activeApp || 'com.android.launcher'}
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-medium text-emerald-300">
                    60 fps
                  </span>
                </div>

                {/* Interactive App Body */}
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-3.5 py-1.5">
                  <div className="flex gap-1 rounded-lg bg-white/[0.06] p-0.5 text-[10px]">
                    {(['shop', 'orders', 'logs'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'flex-1 rounded-md py-1 transition-colors',
                          activeTab === tab ? 'bg-white/15 font-medium text-white' : 'text-slate-400 hover:text-slate-200',
                        )}
                      >
                        {tab === 'shop' ? '结账页' : tab === 'orders' ? '测试用例' : '事件流'}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'shop' ? (
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-slate-200">Pro Plan · 年度订阅</span>
                          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-200">
                            v2.4
                          </span>
                        </div>
                        <p className="mt-1 text-[10.5px] leading-4 text-slate-400">
                          点击画面任意位置可直接映射设备物理坐标并同步到当前会话。
                        </p>
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                        <div>
                          <div className="text-[11px] font-medium text-slate-200">席位数量</div>
                          <div className="text-[10px] text-slate-400">¥129.00 / 月</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCount((c) => Math.max(1, c - 1))}
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-xs hover:bg-white/20"
                          >
                            -
                          </button>
                          <span className="w-4 text-center font-mono text-[11px]">{count}</span>
                          <button
                            type="button"
                            onClick={() => setCount((c) => c + 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-xs hover:bg-white/20"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="mt-auto rounded-xl bg-indigo-500/90 py-2.5 text-center text-[11.5px] font-semibold text-white shadow-lg shadow-indigo-500/20">
                        确认并继续（¥{(count * 129).toFixed(2)}）
                      </div>
                    </div>
                  ) : activeTab === 'orders' ? (
                    <div className="space-y-1.5">
                      {['#A104 · 蓝牙音频测试', '#A105 · 权限弹窗回归', '#A106 · 深色主题截图'].map((row) => (
                        <div
                          key={row}
                          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[10.5px]"
                        >
                          <span className="truncate">{row}</span>
                          <span className="text-[9.5px] text-emerald-300">OK</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-black/35 p-2.5 font-mono text-[9.5px] leading-4 text-emerald-300/90">
                      <div>$ adb devices</div>
                      <div>{payload.serial} device</div>
                      <div className="mt-1 text-slate-300">$ {lastCmd}</div>
                    </div>
                  )}
                </div>

                {/* Android Navigation Bar */}
                <div className="flex h-9 shrink-0 items-center justify-around border-t border-white/10 bg-black/25 px-6 text-slate-300">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendKey('BACK', '4')
                    }}
                    title="返回 (KEYCODE_BACK)"
                    className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendKey('HOME', '3')
                    }}
                    title="主页 (KEYCODE_HOME)"
                    className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
                  >
                    <Circle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendKey('APP_SWITCH', '187')
                    }}
                    title="最近任务 (KEYCODE_APP_SWITCH)"
                    className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                </div>
              </>
            )}

            {/* AI Vision Overlay Markers */}
            {markers.map((marker) => {
              const left = marker.unit === 'px' ? `${(marker.x / widthPx) * 100}%` : `${marker.x * 100}%`
              const top = marker.unit === 'px' ? `${(marker.y / heightPx) * 100}%` : `${marker.y * 100}%`
              if (marker.kind === 'box') {
                const w = marker.unit === 'px' ? `${((marker.w ?? 120) / widthPx) * 100}%` : `${(marker.w ?? 0.25) * 100}%`
                const h = marker.unit === 'px' ? `${((marker.h ?? 80) / heightPx) * 100}%` : `${(marker.h ?? 0.08) * 100}%`
                return (
                  <div
                    key={marker.id}
                    className="pointer-events-none absolute rounded-lg border-2 border-amber-400/90 bg-amber-400/10 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                    style={{ left, top, width: w, height: h }}
                  >
                    {marker.label ? (
                      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-amber-400 px-1.5 py-0.5 text-[9.5px] font-semibold text-slate-950 shadow">
                        {marker.label}
                      </span>
                    ) : null}
                  </div>
                )
              }
              return (
                <div
                  key={marker.id}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left, top }}
                >
                  <span className="block h-5 w-5 animate-ping rounded-full bg-amber-400/50" />
                  <span className="absolute inset-1 rounded-full border-2 border-white bg-amber-400 shadow" />
                </div>
              )
            })}

            {/* User Click Ripples */}
            {ripples.map((r) => (
              <div
                key={r.id}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${r.rx * 100}%`, top: `${r.ry * 100}%` }}
              >
                <span className="block h-6 w-6 rounded-full border-2 border-sky-400 bg-sky-400/25" />
                <span className="absolute left-3 top-3 whitespace-nowrap rounded bg-black/80 px-1 py-0.5 font-mono text-[9px] text-sky-300">
                  {r.px},{r.py}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Telemetry Strip */}
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/35 bg-[var(--bg-1)]/60 px-3 text-[10.5px] text-foreground-secondary">
        <div className="flex min-w-0 items-center gap-1.5 font-mono">
          <Smartphone className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{lastCmd}</span>
        </div>
        <span className="shrink-0 text-[10px] opacity-65">占位演示 · 协议就绪</span>
      </div>
    </div>
  )
}
