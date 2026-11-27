import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CanvasDevicePayload, CanvasSurface } from '@shared/canvas-types'
import {
  ArrowLeft,
  Circle,
  Eye,
  EyeOff,
  MessageSquarePlus,
  RefreshCw,
  Smartphone,
  Square,
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

  const screenRef = useRef<HTMLDivElement>(null)
  const [showMarkers, setShowMarkers] = useState(true)
  const [landscape, setLandscape] = useState(payload.orientation === 'landscape')
  const [ripples, setRipples] = useState<TapRipple[]>([])
  const [lastCmd, setLastCmd] = useState(payload.lastAction || '')

  const widthPx = landscape ? payload.resolution.height : payload.resolution.width
  const heightPx = landscape ? payload.resolution.width : payload.resolution.height
  const markers = showMarkers ? (payload.markers ?? []) : []

  const emitDeviceTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!payload.frameDataUrl) return
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

  const attachContextToComposer = () => {
    const summary = `[ADB 设备画面 · ${payload.deviceName} (${payload.serial})]\n分辨率: ${widthPx}×${heightPx} · 当前应用: ${payload.activeApp || 'unknown'}${lastCmd ? `\n最近操作: ${lastCmd}` : ''}`
    window.dispatchEvent(
      new CustomEvent('pi-desktop:composer-attach-files', {
        detail: { files: [], text: summary },
      }),
    )
    toast.success('已将设备上下文插入输入框')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Device Status & Action Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                payload.status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            <span className="truncate">{payload.deviceName}</span>
          </span>
          <span className="hidden font-mono text-[10.5px] text-foreground-secondary/65 sm:inline">
            {payload.serial}
          </span>
          <span className="hidden text-[10.5px] tabular-nums text-foreground-secondary/55 md:inline">
            {widthPx}×{heightPx}{payload.fps ? ` · ${payload.fps}fps` : ''}
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
          className={cn(
            'relative flex flex-col overflow-hidden rounded-[24px] border border-border/60 bg-[#0f1117] p-2 shadow-lg transition-all duration-300',
            landscape ? 'aspect-[19.5/9.5] w-full max-w-[540px]' : 'aspect-[9/19.2] h-full max-h-[560px] min-h-[340px]',
          )}
        >
          <div
            ref={screenRef}
            onClick={emitDeviceTap}
            className={cn(
              'relative flex min-h-0 flex-1 select-none flex-col overflow-hidden rounded-[18px] bg-[#11131a] text-slate-100',
              payload.frameDataUrl && 'cursor-crosshair',
            )}
          >
            {payload.frameDataUrl ? (
              <img
                src={payload.frameDataUrl}
                alt={payload.deviceName}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-slate-400">
                <Smartphone className="h-6 w-6 opacity-50" />
                <div className="text-[12px] font-medium text-slate-200">{payload.deviceName}</div>
                <div className="text-[11px] leading-relaxed text-slate-400">等待实时画面帧…</div>
              </div>
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

          {payload.platform === 'android' ? (
            <div className="mt-1.5 flex h-8 shrink-0 items-center justify-around rounded-b-[14px] bg-black/25 px-6 text-slate-300">
              <button
                type="button"
                onClick={() => sendKey('BACK', '4')}
                title="返回 (KEYCODE_BACK)"
                className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sendKey('HOME', '3')}
                title="主页 (KEYCODE_HOME)"
                className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <Circle className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sendKey('APP_SWITCH', '187')}
                title="最近任务 (KEYCODE_APP_SWITCH)"
                className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <Square className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom Telemetry Strip */}
      {lastCmd ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border/35 bg-[var(--bg-1)]/60 px-3 text-[10.5px] text-foreground-secondary">
          <Smartphone className="h-3 w-3 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate font-mono">{lastCmd}</span>
        </div>
      ) : null}
    </div>
  )
}
