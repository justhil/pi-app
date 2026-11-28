import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CanvasDevicePayload, CanvasSurface } from '@shared/canvas-types'
import {
  AlertCircle,
  ArrowLeft,
  Circle,
  Eye,
  EyeOff,
  Keyboard,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Send,
  Smartphone,
  Square,
  Target,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { quoteCanvasToComposer, useCanvasStore } from '../canvas-store'

interface TapRipple {
  id: number
  rx: number
  ry: number
  px: number
  py: number
}

interface DragTrace {
  startRx: number
  startRy: number
  curRx: number
  curRy: number
  startPx: number
  startPy: number
  startedAt: number
}

function isLiveAdbMode(mode: CanvasDevicePayload['streamMode']): boolean {
  return mode === 'adb-screencap' || mode === 'screencap'
}

export function DeviceStreamSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDevicePayload
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)

  const screenRef = useRef<HTMLDivElement>(null)
  const [showMarkers, setShowMarkers] = useState(true)
  const [landscape, setLandscape] = useState(payload.orientation === 'landscape')
  const [controlMode, setControlMode] = useState<'control' | 'annotate'>(
    payload.controlMode ?? (isLiveAdbMode(payload.streamMode) ? 'control' : 'annotate'),
  )
  const [streamingActive, setStreamingActive] = useState<boolean>(
    isLiveAdbMode(payload.streamMode) && payload.autoStream !== false,
  )
  const [ripples, setRipples] = useState<TapRipple[]>([])
  const [dragTrace, setDragTrace] = useState<DragTrace | null>(null)
  const [lastCmd, setLastCmd] = useState(payload.lastAction || '')
  const [inputOpen, setInputOpen] = useState(false)
  const [inputDraft, setInputDraft] = useState('')
  const [wsFrameUrl, setWsFrameUrl] = useState<string | null>(null)
  const [wsError, setWsError] = useState<string | null>(null)
  const [capturingOnce, setCapturingOnce] = useState(false)

  const resolution = payload.resolution ?? { width: 1080, height: 2400 }
  const widthPx = landscape ? resolution.height : resolution.width
  const heightPx = landscape ? resolution.width : resolution.height
  const markers = showMarkers ? (payload.markers ?? []) : []
  const adbCapable = payload.platform === 'android' && Boolean(payload.serial?.trim())

  // L1: Main-process ADB screencap stream lifecycle (auto-starts when adb-screencap + streamingActive).
  useEffect(() => {
    if (!adbCapable || !isLiveAdbMode(payload.streamMode) || !streamingActive) return
    const serial = payload.serial
    let cancelled = false
    void ipcClient
      .invoke('canvas.adb.startStream', {
        serial,
        intervalMs: payload.intervalMs ?? 350,
      })
      .then((res) => {
        if (!cancelled && res && !res.ok && res.error) {
          useCanvasStore.getState().applyAdbStatus({
            type: 'canvas-adb-status',
            serial,
            status: 'error',
            error: String(res.error),
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      void ipcClient.invoke('canvas.adb.stopStream', { serial }).catch(() => {})
    }
  }, [adbCapable, payload.intervalMs, payload.serial, payload.streamMode, streamingActive])

  // L2: Optional high-FPS WebSocket frame stream (binary Blob or data:image URL), revoking old Blob URLs cleanly.
  useEffect(() => {
    if (payload.streamMode !== 'ws-frames' || !payload.streamUrl) {
      setWsFrameUrl(null)
      setWsError(null)
      return
    }
    let closed = false
    let prevObjectUrl: string | null = null
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket(payload.streamUrl)
      ws.binaryType = 'blob'
      ws.onopen = () => {
        if (!closed) setWsError(null)
      }
      ws.onmessage = (ev) => {
        if (closed) return
        if (typeof ev.data === 'string' && ev.data.startsWith('data:image/')) {
          if (prevObjectUrl) {
            URL.revokeObjectURL(prevObjectUrl)
            prevObjectUrl = null
          }
          setWsFrameUrl(ev.data)
          return
        }
        if (ev.data instanceof Blob) {
          const nextUrl = URL.createObjectURL(ev.data)
          if (prevObjectUrl) URL.revokeObjectURL(prevObjectUrl)
          prevObjectUrl = nextUrl
          setWsFrameUrl(nextUrl)
        }
      }
      ws.onerror = () => {
        if (!closed) setWsError(`WebSocket 流连接失败: ${payload.streamUrl}`)
      }
      ws.onclose = () => {
        if (!closed) setWsError((prev) => prev ?? 'WebSocket 帧流已断开')
      }
    } catch (error) {
      setWsError(error instanceof Error ? error.message : String(error))
    }
    return () => {
      closed = true
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      if (prevObjectUrl) URL.revokeObjectURL(prevObjectUrl)
    }
  }, [payload.streamMode, payload.streamUrl])

  const renderedSrc =
    payload.streamMode === 'mjpeg' && payload.streamUrl
      ? payload.streamUrl
      : payload.streamMode === 'ws-frames'
        ? (wsFrameUrl ?? payload.frameDataUrl ?? '')
        : (payload.frameDataUrl ?? '')

  const toDevicePoint = (clientX: number, clientY: number) => {
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    return {
      rx,
      ry,
      px: Math.round(rx * widthPx),
      py: Math.round(ry * heightPx),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !renderedSrc) return
    const pt = toDevicePoint(e.clientX, e.clientY)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragTrace({
      startRx: pt.rx,
      startRy: pt.ry,
      curRx: pt.rx,
      curRy: pt.ry,
      startPx: pt.px,
      startPy: pt.py,
      startedAt: Date.now(),
    })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragTrace) return
    const pt = toDevicePoint(e.clientX, e.clientY)
    if (!pt) return
    setDragTrace((prev) => (prev ? { ...prev, curRx: pt.rx, curRy: pt.ry } : null))
  }

  const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const trace = dragTrace
    setDragTrace(null)
    if (!trace) return
    const endPt = toDevicePoint(e.clientX, e.clientY)
    if (!endPt) return

    const dxPx = endPt.px - trace.startPx
    const dyPx = endPt.py - trace.startPy
    const dist = Math.hypot(dxPx, dyPx)
    const liveControl = controlMode === 'control' && adbCapable

    if (dist < 18) {
      const cmd = `adb -s ${payload.serial} shell input tap ${endPt.px} ${endPt.py}`
      const id = Date.now()
      setRipples((prev) => [...prev.slice(-3), { id, rx: endPt.rx, ry: endPt.ry, px: endPt.px, py: endPt.py }])
      setLastCmd(liveControl ? cmd : `[仅标注] ${cmd}`)
      recordInteraction(surface.id, {
        lastTap: {
          x: endPt.px,
          y: endPt.py,
          rx: Number(endPt.rx.toFixed(3)),
          ry: Number(endPt.ry.toFixed(3)),
          executed: liveControl,
          cmd,
        },
      })
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((item) => item.id !== id))
      }, 900)
      if (liveControl) {
        const res = await ipcClient
          .invoke('canvas.adb.input', { serial: payload.serial, action: 'tap', x: endPt.px, y: endPt.py })
          .catch((err) => ({ ok: false, error: String(err) }))
        if (!res?.ok) toast.error(`点击失败：${res?.error || 'unknown'}`)
      }
      return
    }

    const durationMs = Math.min(1200, Math.max(120, Date.now() - trace.startedAt))
    const cmd = `adb -s ${payload.serial} shell input swipe ${trace.startPx} ${trace.startPy} ${endPt.px} ${endPt.py} ${durationMs}`
    setLastCmd(liveControl ? cmd : `[仅标注] ${cmd}`)
    recordInteraction(surface.id, {
      lastSwipe: {
        x1: trace.startPx,
        y1: trace.startPy,
        x2: endPt.px,
        y2: endPt.py,
        durationMs,
        executed: liveControl,
        cmd,
      },
    })
    if (liveControl) {
      const res = await ipcClient
        .invoke('canvas.adb.input', {
          serial: payload.serial,
          action: 'swipe',
          x1: trace.startPx,
          y1: trace.startPy,
          x2: endPt.px,
          y2: endPt.py,
          durationMs,
        })
        .catch((err) => ({ ok: false, error: String(err) }))
      if (!res?.ok) toast.error(`滑动失败：${res?.error || 'unknown'}`)
    }
  }

  const sendKey = async (keyName: string, keyCode: string) => {
    const liveControl = controlMode === 'control' && adbCapable
    const cmd = `adb -s ${payload.serial} shell input keyevent ${keyCode}`
    setLastCmd(liveControl ? cmd : `[仅标注] ${cmd}`)
    recordInteraction(surface.id, { lastKey: { keyName, keyCode, executed: liveControl, cmd } })
    if (liveControl) {
      const res = await ipcClient
        .invoke('canvas.adb.input', { serial: payload.serial, action: 'keyevent', keyCode })
        .catch((err) => ({ ok: false, error: String(err) }))
      if (!res?.ok) toast.error(`按键 ${keyName} 失败：${res?.error || 'unknown'}`)
    }
  }

  const submitText = async () => {
    const text = inputDraft.trim()
    if (!text) return
    const liveControl = controlMode === 'control' && adbCapable
    if (liveControl) {
      const res = await ipcClient
        .invoke('canvas.adb.input', { serial: payload.serial, action: 'text', text })
        .catch((err) => ({ ok: false, error: String(err) }))
      if (!res?.ok) {
        toast.error(
          res?.error === 'adb_text_ascii_only'
            ? 'ADB 原生 input text 仅支持 ASCII 字符'
            : `输入失败：${res?.error || 'unknown'}`,
        )
        return
      }
      setLastCmd(res.cmd || `adb -s ${payload.serial} shell input text ...`)
    } else {
      setLastCmd(`[仅标注] input text: ${text}`)
    }
    recordInteraction(surface.id, { lastText: { text, executed: liveControl } })
    setInputDraft('')
    setInputOpen(false)
  }

  const captureSingleFrame = async () => {
    if (!adbCapable || capturingOnce) return
    setCapturingOnce(true)
    try {
      const res = await ipcClient.invoke('canvas.adb.input', { serial: payload.serial, action: 'capture' })
      if (!res?.ok) toast.error(`抓帧失败：${res?.error || 'unknown'}`)
    } catch (err) {
      toast.error(`抓帧失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCapturingOnce(false)
    }
  }

  const attachContextToComposer = async () => {
    const summary = `[ADB 设备画面 · ${payload.deviceName} (${payload.serial})]\n分辨率: ${widthPx}×${heightPx} · 模式: ${controlMode === 'control' ? '真控机' : '仅标注'}${payload.activeApp ? ` · 应用: ${payload.activeApp}` : ''}${lastCmd ? `\n最近操作: ${lastCmd}` : ''}`
    const files: { path: string; name: string; kind: string }[] = []
    if (renderedSrc.startsWith('data:image/')) {
      const comma = renderedSrc.indexOf(',')
      const mimeMatch = /^data:(image\/[a-zA-Z0-9+.-]+);base64$/.exec(renderedSrc.slice(0, comma))
      if (mimeMatch && comma > 0) {
        try {
          const saved = await ipcClient.invoke('clipboard.writeTempImage', {
            data: renderedSrc.slice(comma + 1),
            mimeType: mimeMatch[1],
          })
          if (saved?.path) {
            files.push({ path: saved.path, name: `${payload.serial}-screen.png`, kind: 'image' })
          }
        } catch {
          /* fall back to text-only quote */
        }
      }
    }
    quoteCanvasToComposer(summary, files)
    toast.success(files.length > 0 ? '已将设备截图与上下文插入输入框' : '已将设备上下文插入输入框')
  }

  const statusColor =
    payload.status === 'connected'
      ? 'bg-emerald-500'
      : payload.status === 'error'
        ? 'bg-destructive'
        : payload.status === 'connecting'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-foreground-secondary/45'

  const errorText = wsError || payload.error

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      {/* Device Status & Action Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusColor)} />
            <span className="truncate">{payload.deviceName || payload.serial}</span>
          </span>
          <span className="hidden font-mono text-[10.5px] text-foreground-secondary/65 sm:inline">
            {payload.serial}
          </span>
          <span className="hidden text-[10.5px] tabular-nums text-foreground-secondary/55 md:inline">
            {widthPx}×{heightPx}
            {payload.fps ? ` · ${payload.fps}fps` : ''}
            {payload.battery != null ? ` · ${payload.battery}%` : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {adbCapable && isLiveAdbMode(payload.streamMode) ? (
            <button
              type="button"
              onClick={() => setStreamingActive((v) => !v)}
              title={streamingActive ? '暂停实时帧流' : '开启实时帧流'}
              aria-pressed={streamingActive}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                streamingActive
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              {streamingActive ? <Square className="h-2.5 w-2.5" /> : <Play className="h-3 w-3" />}
            </button>
          ) : null}

          {adbCapable ? (
            <button
              type="button"
              onClick={() => void captureSingleFrame()}
              disabled={capturingOnce}
              title="立即抓取一帧"
              className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-45"
            >
              <RefreshCw className={cn('h-3 w-3', capturingOnce && 'animate-spin')} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setControlMode((m) => (m === 'control' ? 'annotate' : 'control'))}
            title={
              controlMode === 'control'
                ? '当前：真控机模式（点击/滑动会通过 ADB 直接操控设备），点击切为仅标注'
                : '当前：仅标注模式（只记录坐标供 AI 读取，防误触），点击切为真控机'
            }
            aria-pressed={controlMode === 'control'}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium transition-colors',
              controlMode === 'control' && adbCapable
                ? 'bg-[var(--brand)]/15 text-[var(--brand)]'
                : 'bg-foreground/[0.05] text-foreground-secondary hover:text-foreground',
            )}
          >
            <Target className="h-3 w-3" />
            <span>{controlMode === 'control' && adbCapable ? '操控' : '标注'}</span>
          </button>

          {adbCapable ? (
            <button
              type="button"
              onClick={() => setInputOpen((v) => !v)}
              title="向设备输入文本 (ASCII)"
              aria-pressed={inputOpen}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                inputOpen
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          ) : null}

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
            title="旋转显示方向"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Smartphone className={cn('h-3.5 w-3.5 transition-transform', landscape && 'rotate-90')} />
          </button>

          <button
            type="button"
            onClick={() => void attachContextToComposer()}
            title="将设备截图与上下文发送到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {errorText ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {errorText === 'adb_not_found'
              ? '未找到本机 adb 命令，请安装 Android Platform-Tools 并加入 PATH。'
              : errorText}
          </span>
        </div>
      ) : null}

      {inputOpen ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/35 bg-[var(--bg-1)]/60 px-3 py-1.5">
          <input
            type="text"
            value={inputDraft}
            onChange={(e) => setInputDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitText()
              if (e.key === 'Escape') setInputOpen(false)
            }}
            placeholder="输入要发送到手机的 ASCII 文本，回车发送…"
            className="h-6 min-w-0 flex-1 rounded-md border border-border/55 bg-background px-2 text-[11.5px] text-foreground outline-none focus:border-ring"
          />
          <button
            type="button"
            onClick={() => void submitText()}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-foreground px-2 text-[11px] font-medium text-background hover:opacity-90"
          >
            <Send className="h-2.5 w-2.5" />
            <span>发送</span>
          </button>
        </div>
      ) : null}

      {/* Device Viewport Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <div
          className={cn(
            'relative flex flex-col overflow-hidden rounded-[24px] border border-border/60 bg-[#0f1117] p-2 shadow-lg transition-all duration-300',
            landscape
              ? 'aspect-[19.5/9.5] w-full max-w-[560px]'
              : 'aspect-[9/19.2] h-full max-h-[580px] min-h-[340px]',
          )}
        >
          <div
            ref={screenRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => void handlePointerUp(e)}
            onPointerCancel={() => setDragTrace(null)}
            className={cn(
              'relative flex min-h-0 flex-1 touch-none select-none flex-col overflow-hidden rounded-[18px] bg-[#11131a] text-slate-100',
              renderedSrc && 'cursor-crosshair',
            )}
          >
            {renderedSrc ? (
              <img
                src={renderedSrc}
                alt={payload.deviceName || payload.serial}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-slate-400">
                <Smartphone className="h-6 w-6 opacity-50" />
                <div className="text-[12px] font-medium text-slate-200">{payload.deviceName || payload.serial}</div>
                <div className="text-[11px] leading-relaxed text-slate-400">
                  {payload.status === 'connecting' ? '正在拉取设备实时画面…' : '等待实时画面帧…'}
                </div>
              </div>
            )}

            {/* Live swipe drag trace line */}
            {dragTrace ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <line
                  x1={dragTrace.startRx * 100}
                  y1={dragTrace.startRy * 100}
                  x2={dragTrace.curRx * 100}
                  y2={dragTrace.curRy * 100}
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  strokeDasharray="2 1.5"
                />
                <circle cx={dragTrace.startRx * 100} cy={dragTrace.startRy * 100} r="1.8" fill="#38bdf8" />
                <circle cx={dragTrace.curRx * 100} cy={dragTrace.curRy * 100} r="2.2" fill="#0ea5e9" />
              </svg>
            ) : null}

            {/* AI Vision Overlay Markers */}
            {markers.map((marker) => {
              const left = marker.unit === 'px' ? `${(marker.x / widthPx) * 100}%` : `${marker.x * 100}%`
              const top = marker.unit === 'px' ? `${(marker.y / heightPx) * 100}%` : `${marker.y * 100}%`
              if (marker.kind === 'box') {
                const w =
                  marker.unit === 'px' ? `${((marker.w ?? 120) / widthPx) * 100}%` : `${(marker.w ?? 0.25) * 100}%`
                const h =
                  marker.unit === 'px' ? `${((marker.h ?? 80) / heightPx) * 100}%` : `${(marker.h ?? 0.08) * 100}%`
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
                  {marker.label ? (
                    <span className="absolute left-4 top-0 whitespace-nowrap rounded bg-amber-400 px-1 py-0.5 text-[9px] font-semibold text-slate-950 shadow">
                      {marker.label}
                    </span>
                  ) : null}
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
                onClick={() => void sendKey('BACK', '4')}
                title="返回 (KEYCODE_BACK)"
                className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void sendKey('HOME', '3')}
                title="主页 (KEYCODE_HOME)"
                className="flex h-7 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <Circle className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void sendKey('APP_SWITCH', '187')}
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
