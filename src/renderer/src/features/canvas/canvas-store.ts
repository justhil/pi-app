import { create } from 'zustand'
import type {
  CanvasDelegationPayload,
  CanvasDevicePayload,
  CanvasDiagramPayload,
  CanvasHtmlPayload,
  CanvasMarkdownPayload,
  CanvasSurface,
  CanvasSurfaceKind,
  CanvasSurfacePayload,
  CanvasToolCallEvent,
  CanvasUiBlockPayload,
} from '@shared/canvas-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'

export type CanvasLayoutMode = 'single' | 'grid'

export function createDemoSurfaces(): CanvasSurface[] {
  const now = Date.now()
  return [
    {
      id: 'adb-pixel-9',
      title: 'Pixel 9 Pro',
      subtitle: '1080×2400 · 60fps',
      kind: 'device-stream',
      source: 'demo',
      pinned: true,
      createdAt: now - 180_000,
      updatedAt: now - 4_000,
      payload: {
        deviceName: 'Pixel 9 Pro',
        serial: 'emulator-5554',
        platform: 'android',
        resolution: { width: 1080, height: 2400 },
        orientation: 'portrait',
        streamMode: 'mock-adb',
        fps: 60,
        battery: 87,
        activeApp: 'com.pi.mobile.checkout',
        status: 'connected',
        interactive: true,
        lastAction: 'input tap 540 1812',
        markers: [
          {
            id: 'ai-target-1',
            kind: 'box',
            x: 0.1,
            y: 0.71,
            w: 0.8,
            h: 0.09,
            unit: 'ratio',
            label: '确认并继续',
          },
          {
            id: 'ai-tap-1',
            kind: 'tap',
            x: 0.5,
            y: 0.755,
            unit: 'ratio',
            label: '(540, 1812)',
          },
        ],
      } satisfies CanvasDevicePayload,
    },
    {
      id: 'delegation-live',
      title: '委派拓扑',
      subtitle: '多代理任务执行树',
      kind: 'delegation-tree',
      source: 'demo',
      createdAt: now - 120_000,
      updatedAt: now - 2_000,
      payload: {
        source: 'live',
        title: '委派执行树',
        summary: '并行子任务执行拓扑与实时状态',
      } satisfies CanvasDelegationPayload,
    },
    {
      id: 'pi-ui-metrics',
      title: '构建耗时',
      subtitle: '各模块编译对比',
      kind: 'ui-block',
      source: 'demo',
      createdAt: now - 60_000,
      updatedAt: now - 1_000,
      payload: {
        component: 'chart',
        props: {
          title: '各模块构建耗时对比（ms）',
          type: 'bar',
          x: ['Main', 'Preload', 'Worker', 'Renderer', 'Shared'],
          series: [
            { name: '优化前', data: [840, 290, 1120, 3450, 410] },
            { name: '优化后', data: [610, 220, 790, 2180, 280] },
          ],
          unit: 'ms',
          height: 240,
        },
      } satisfies CanvasUiBlockPayload,
    },
    {
      id: 'sandbox-proto',
      title: '参数面板',
      subtitle: '实时投屏编码配置',
      kind: 'html',
      source: 'demo',
      createdAt: now - 30_000,
      updatedAt: now,
      payload: {
        title: 'Stream Encoder Settings',
        allowScripts: true,
        html: `<div class="card">
  <div class="head">
    <span class="dot"></span>
    <strong>设备流编码参数</strong>
    <span class="tag">H.264</span>
  </div>
  <p class="desc">调整帧率上限与画质参数，点击应用即可同步到当前会话上下文。</p>
  <div class="row">
    <label>帧率上限 <strong id="fps-val">60 fps</strong></label>
    <input id="fps" type="range" min="15" max="120" step="15" value="60" />
  </div>
  <div class="actions">
    <button id="btn-apply" class="primary">应用配置</button>
    <button id="btn-ping">连通性测试</button>
  </div>
  <div id="status" class="status">参数就绪</div>
</div>
<script>
  const fps = document.getElementById('fps');
  const fpsVal = document.getElementById('fps-val');
  const status = document.getElementById('status');
  const send = (type, detail) => {
    window.parent.postMessage({ source: 'pi-canvas-sandbox', type, detail }, '*');
    status.textContent = type === 'config_apply' ? '已应用 · ' + detail.maxFps + ' fps' : '连通正常 · 18ms';
  };
  fps.addEventListener('input', () => { fpsVal.textContent = fps.value + ' fps'; });
  document.getElementById('btn-apply').addEventListener('click', () => send('config_apply', { maxFps: Number(fps.value), encoder: 'h264' }));
  document.getElementById('btn-ping').addEventListener('click', () => send('ping', { ts: Date.now() }));
</script>`,
        css: `
          body { margin: 0; padding: 16px; font-family: var(--font-sans, system-ui, sans-serif); color: var(--text-primary, #e5e7eb); background: transparent; }
          .card { border: 1px solid var(--border-base, rgba(148,163,184,0.22)); border-radius: 12px; padding: 16px; background: var(--bg-1, rgba(128,128,128,0.06)); }
          .head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; }
          .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--success-semantic, #22c55e); }
          .tag { margin-left: auto; font-size: 10px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border-base, rgba(148,163,184,0.25)); opacity: 0.75; font-family: monospace; }
          .desc { font-size: 12px; line-height: 1.6; opacity: 0.8; margin: 0 0 14px; }
          code { font-family: var(--font-mono, monospace); font-size: 11px; padding: 1px 4px; border-radius: 4px; background: rgba(128,128,128,0.16); }
          .row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; font-size: 12px; }
          .row label { display: flex; justify-content: space-between; }
          input[type=range] { width: 100%; accent-color: var(--brand, #7583b2); }
          .actions { display: flex; gap: 8px; }
          button { flex: 1; height: 30px; border-radius: 7px; border: 1px solid var(--border-base, rgba(148,163,184,0.28)); background: transparent; color: inherit; font-size: 12px; cursor: pointer; }
          button:hover { background: rgba(128,128,128,0.12); }
          button.primary { background: var(--brand, #7583b2); color: #fff; border-color: transparent; font-weight: 500; }
          button.primary:hover { opacity: 0.9; }
          .status { margin-top: 12px; font-size: 11px; font-family: var(--font-mono, monospace); opacity: 0.72; word-break: break-all; }
        `,
      } satisfies CanvasHtmlPayload,
    },
  ]
}

export function createMermaidDemoSurface(): CanvasSurface {
  const now = Date.now()
  return {
    id: `arch-diagram-${now.toString(36).slice(-4)}`,
    title: '画布链路架构',
    subtitle: 'Mermaid 矢量渲染',
    kind: 'diagram',
    source: 'demo',
    badge: 'SVG',
    createdAt: now,
    updatedAt: now,
    payload: {
      format: 'mermaid',
      caption: 'AI 通过 canvas_* 工具经由 Worker → Main → Canvas Stage 投射任意表面',
      code: `flowchart LR
  Agent[Pi Agent] -->|canvas_present / update| Ext[Inline Extension]
  Ext -->|IPC Bridge| Main[Main Process]
  Main -->|ipc:canvas-event| Stage[Right AI Canvas]
  Stage --> Device[ADB 手机投屏]
  Stage --> Tree[委派拓扑图]
  Stage --> Block[pi-ui 组件]
  Stage --> Sandbox[HTML / Mermaid]
  Stage -.->|canvas_read 交互回传| Agent`,
    } satisfies CanvasDiagramPayload,
  }
}

export function createStatGridDemoSurface(): CanvasSurface {
  const now = Date.now()
  return {
    id: `kpi-grid-${now.toString(36).slice(-4)}`,
    title: '实时运行看板',
    subtitle: 'pi-ui stat-grid',
    kind: 'ui-block',
    source: 'demo',
    badge: 'KPI',
    createdAt: now,
    updatedAt: now,
    payload: {
      component: 'stat-grid',
      props: {
        title: '会话与设备运行概览',
        items: [
          { label: '活跃子代理', value: '2', delta: '+1', trend: 'up', history: [0, 1, 1, 2, 2] },
          { label: 'ADB 帧延迟', value: '18', unit: 'ms', delta: '-6ms', trend: 'up', history: [34, 28, 25, 22, 18] },
          { label: '本轮 Token', value: '23.1k', delta: '缓存 84%', trend: 'up' },
          { label: '画布表面', value: '4', unit: '个', delta: '实时同步' },
        ],
      },
    } satisfies CanvasUiBlockPayload,
  }
}

export interface PresentSurfaceInput {
  id: string
  title: string
  subtitle?: string
  kind: CanvasSurfaceKind
  payload: CanvasSurfacePayload
  source?: 'ai' | 'user' | 'demo'
  pinned?: boolean
  sessionFile?: string | null
  badge?: string
  focus?: boolean
}

interface CanvasState {
  surfaces: CanvasSurface[]
  activeSurfaceId: string | null
  layoutMode: CanvasLayoutMode
  protocolDrawerOpen: boolean

  presentSurface: (input: PresentSurfaceInput) => CanvasSurface
  updateSurface: (
    id: string,
    patch: { title?: string; subtitle?: string; payloadPatch?: Record<string, unknown>; focus?: boolean },
  ) => CanvasSurface | null
  removeSurface: (id: string) => boolean
  clearNonPinned: () => number
  selectSurface: (id: string) => void
  togglePinSurface: (id: string) => void
  setLayoutMode: (mode: CanvasLayoutMode) => void
  setProtocolDrawerOpen: (open: boolean) => void
  recordInteraction: (id: string, patch: Record<string, unknown>) => void
  restoreDemos: () => void
}

const initialDemos = createDemoSurfaces()

export const useCanvasStore = create<CanvasState>((set, get) => ({
  surfaces: initialDemos,
  activeSurfaceId: initialDemos[0]?.id ?? null,
  layoutMode: 'single',
  protocolDrawerOpen: false,

  presentSurface: (input) => {
    const now = Date.now()
    const existing = get().surfaces.find((s) => s.id === input.id)
    const nextSurface: CanvasSurface = {
      id: input.id,
      title: input.title,
      subtitle: input.subtitle,
      kind: input.kind,
      payload: input.payload,
      source: input.source ?? 'ai',
      pinned: input.pinned ?? existing?.pinned ?? false,
      sessionFile: input.sessionFile ?? existing?.sessionFile ?? null,
      badge: input.badge ?? existing?.badge,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      interactionState: existing?.interactionState,
    }
    set((s) => {
      const idx = s.surfaces.findIndex((item) => item.id === input.id)
      const surfaces =
        idx >= 0
          ? s.surfaces.map((item, i) => (i === idx ? nextSurface : item))
          : [...s.surfaces, nextSurface]
      return {
        surfaces,
        activeSurfaceId: input.focus === false ? (s.activeSurfaceId ?? nextSurface.id) : nextSurface.id,
      }
    })
    return nextSurface
  },

  updateSurface: (id, patch) => {
    const existing = get().surfaces.find((s) => s.id === id)
    if (!existing) return null
    const mergedPayload =
      patch.payloadPatch && typeof existing.payload === 'object'
        ? ({ ...existing.payload, ...patch.payloadPatch } as CanvasSurfacePayload)
        : existing.payload
    const updated: CanvasSurface = {
      ...existing,
      title: patch.title ?? existing.title,
      subtitle: patch.subtitle ?? existing.subtitle,
      payload: mergedPayload,
      updatedAt: Date.now(),
    }
    set((s) => ({
      surfaces: s.surfaces.map((item) => (item.id === id ? updated : item)),
      activeSurfaceId: patch.focus ? id : s.activeSurfaceId,
    }))
    return updated
  },

  removeSurface: (id) => {
    const exists = get().surfaces.some((s) => s.id === id)
    if (!exists) return false
    set((s) => {
      const surfaces = s.surfaces.filter((item) => item.id !== id)
      const activeSurfaceId =
        s.activeSurfaceId === id ? (surfaces[surfaces.length - 1]?.id ?? null) : s.activeSurfaceId
      return { surfaces, activeSurfaceId }
    })
    return true
  },

  clearNonPinned: () => {
    const cur = get().surfaces
    const kept = cur.filter((s) => s.pinned)
    const removed = cur.length - kept.length
    set((s) => ({
      surfaces: kept,
      activeSurfaceId: kept.some((k) => k.id === s.activeSurfaceId)
        ? s.activeSurfaceId
        : (kept[0]?.id ?? null),
    }))
    return removed
  },

  selectSurface: (id) => set({ activeSurfaceId: id }),

  togglePinSurface: (id) =>
    set((s) => ({
      surfaces: s.surfaces.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
    })),

  setLayoutMode: (layoutMode) => set({ layoutMode }),

  setProtocolDrawerOpen: (protocolDrawerOpen) => set({ protocolDrawerOpen }),

  recordInteraction: (id, patch) =>
    set((s) => ({
      surfaces: s.surfaces.map((item) =>
        item.id === id
          ? {
              ...item,
              interactionState: {
                ...(item.interactionState ?? {}),
                ...patch,
                updatedAt: Date.now(),
              },
            }
          : item,
      ),
    })),

  restoreDemos: () => {
    const demos = createDemoSurfaces()
    set({ surfaces: demos, activeSurfaceId: demos[0]?.id ?? null })
  },
}))

const VALID_KINDS = new Set<CanvasSurfaceKind>([
  'device-stream',
  'delegation-tree',
  'ui-block',
  'html',
  'diagram',
  'markdown',
])

function revealCanvasStage(): void {
  useRightDockStore.getState().activatePanelSmart('canvas')
  useUIStore.getState().revealRightPanel()
}

export function handleCanvasToolCallEvent(event: CanvasToolCallEvent): void {
  const store = useCanvasStore.getState()
  const args = event.args ?? {}

  const reply = (text: string, isError = false) => {
    void ipcClient
      .invoke('canvas.toolResponse', {
        callId: event.callId,
        isError,
        content: [{ type: 'text', text }],
      })
      .catch(() => {})
  }

  try {
    if (event.tool === 'canvas_present') {
      const id = String(args.id ?? '').trim()
      const title = String(args.title ?? '').trim()
      const kind = String(args.kind ?? '') as CanvasSurfaceKind
      if (!id || !title || !VALID_KINDS.has(kind)) {
        reply('canvas_invalid_args: id, title, and a valid kind are required', true)
        return
      }
      const payload = (args.payload && typeof args.payload === 'object' ? args.payload : {}) as CanvasSurfacePayload
      const focus = args.focus !== false
      const surface = store.presentSurface({
        id,
        title,
        subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
        kind,
        payload,
        source: 'ai',
        pinned: Boolean(args.pin),
        sessionFile: event.sessionFile ?? null,
        focus,
      })
      if (focus) revealCanvasStage()
      reply(JSON.stringify({ ok: true, id: surface.id, kind: surface.kind, title: surface.title }))
      return
    }

    if (event.tool === 'canvas_update') {
      const id = String(args.id ?? '').trim()
      if (!id) {
        reply('canvas_invalid_args: id is required', true)
        return
      }
      const updated = store.updateSurface(id, {
        title: typeof args.title === 'string' ? args.title : undefined,
        subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
        payloadPatch:
          args.payloadPatch && typeof args.payloadPatch === 'object'
            ? (args.payloadPatch as Record<string, unknown>)
            : undefined,
        focus: Boolean(args.focus),
      })
      if (!updated) {
        reply(`canvas_not_found: surface "${id}" does not exist`, true)
        return
      }
      if (args.focus) revealCanvasStage()
      reply(JSON.stringify({ ok: true, id: updated.id, updatedAt: updated.updatedAt }))
      return
    }

    if (event.tool === 'canvas_read') {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const list = id ? store.surfaces.filter((s) => s.id === id) : store.surfaces
      const summary = list.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
        source: s.source,
        pinned: Boolean(s.pinned),
        active: s.id === store.activeSurfaceId,
        interactionState: s.interactionState ?? null,
        updatedAt: s.updatedAt,
      }))
      reply(JSON.stringify({ activeSurfaceId: store.activeSurfaceId, surfaces: summary }, null, 2))
      return
    }

    if (event.tool === 'canvas_close') {
      if (args.all === true) {
        const removed = store.clearNonPinned()
        reply(JSON.stringify({ ok: true, removed }))
        return
      }
      const id = String(args.id ?? '').trim()
      if (!id) {
        reply('canvas_invalid_args: provide id or all: true', true)
        return
      }
      const removed = store.removeSurface(id)
      reply(JSON.stringify({ ok: removed, id }))
      return
    }

    reply(`canvas_unknown_tool: ${event.tool}`, true)
  } catch (error) {
    reply(`canvas_error: ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

export type { CanvasMarkdownPayload }
