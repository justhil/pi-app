import { create } from 'zustand'
import type {
  CanvasMarkdownPayload,
  CanvasSurface,
  CanvasSurfaceKind,
  CanvasSurfacePayload,
  CanvasToolCallEvent,
} from '@shared/canvas-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'

export type CanvasLayoutMode = 'single' | 'grid'

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
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  surfaces: [],
  activeSurfaceId: null,
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
