import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  CanvasAdbFrameEvent,
  CanvasAdbStatusEvent,
  CanvasDevicePayload,
  CanvasMarkdownPayload,
  CanvasOverlayMarker,
  CanvasSurface,
  CanvasSurfaceKind,
  CanvasSurfacePayload,
  CanvasToolCallEvent,
} from '@shared/canvas-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'

export type CanvasLayoutMode = 'single' | 'grid'

export interface PresentSurfaceInput {
  id: string
  title: string
  subtitle?: string
  kind: CanvasSurfaceKind
  payload: CanvasSurfacePayload
  source?: 'ai' | 'user'
  pinned?: boolean
  sessionFile?: string | null
  badge?: string
  focus?: boolean
}

export interface UpdateSurfaceInput {
  title?: string
  subtitle?: string
  payloadPatch?: Record<string, unknown>
  mergeMode?: 'shallow' | 'deep'
  appendMarkers?: CanvasOverlayMarker[]
  clearMarkers?: boolean
  focus?: boolean
}

interface CanvasState {
  surfaces: CanvasSurface[]
  activeSurfaceId: string | null
  layoutMode: CanvasLayoutMode
  showAllSessions: boolean
  protocolDrawerOpen: boolean

  presentSurface: (input: PresentSurfaceInput) => CanvasSurface
  updateSurface: (id: string, patch: UpdateSurfaceInput) => CanvasSurface | null
  removeSurface: (id: string) => boolean
  clearNonPinned: (scopeSessionFile?: string | null) => number
  selectSurface: (id: string) => void
  togglePinSurface: (id: string) => void
  setLayoutMode: (mode: CanvasLayoutMode) => void
  setShowAllSessions: (showAll: boolean) => void
  setProtocolDrawerOpen: (open: boolean) => void
  recordInteraction: (id: string, patch: Record<string, unknown>) => void
  applyAdbFrame: (event: CanvasAdbFrameEvent) => void
  applyAdbStatus: (event: CanvasAdbStatusEvent) => void
}

const VALID_KINDS = new Set<CanvasSurfaceKind>([
  'device-stream',
  'delegation-tree',
  'ui-block',
  'html',
  'diagram',
  'markdown',
  'image',
])

const MAX_PERSISTED_SURFACES = 24
const MAX_PERSISTED_DATA_URL_CHARS = 96_000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function deepMergeRecord(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth >= 8) return { ...base, ...patch }
  const out: Record<string, unknown> = { ...base }
  for (const [key, val] of Object.entries(patch)) {
    const prev = out[key]
    if (isPlainRecord(prev) && isPlainRecord(val)) {
      out[key] = deepMergeRecord(prev, val, depth + 1)
    } else {
      out[key] = val
    }
  }
  return out
}

function upsertOverlayMarkers(
  existing: CanvasOverlayMarker[] | undefined,
  incoming: CanvasOverlayMarker[],
): CanvasOverlayMarker[] {
  const list = [...(existing ?? [])]
  for (const marker of incoming) {
    if (!marker || typeof marker.id !== 'string' || !marker.id.trim()) continue
    const idx = list.findIndex((item) => item.id === marker.id)
    if (idx >= 0) list[idx] = { ...list[idx], ...marker }
    else list.push(marker)
  }
  return list
}

function sanitizePayloadForPersist(kind: CanvasSurfaceKind, payload: CanvasSurfacePayload): CanvasSurfacePayload {
  if (!isPlainRecord(payload)) return payload
  const copy: Record<string, unknown> = { ...payload }
  if (kind === 'device-stream') {
    // Never persist raw screen frames into localStorage; reconnect cleanly on demand.
    delete copy.frameDataUrl
    if (copy.status === 'connected' || copy.status === 'connecting') {
      copy.status = 'disconnected'
    }
  }
  if (kind === 'image') {
    if (typeof copy.src === 'string' && copy.src.startsWith('data:') && copy.src.length > MAX_PERSISTED_DATA_URL_CHARS) {
      delete copy.src
    }
    if (
      typeof copy.compareSrc === 'string' &&
      copy.compareSrc.startsWith('data:') &&
      copy.compareSrc.length > MAX_PERSISTED_DATA_URL_CHARS
    ) {
      delete copy.compareSrc
    }
    if (Array.isArray(copy.images)) {
      copy.images = copy.images.map((item) => {
        if (!isPlainRecord(item)) return item
        const next = { ...item }
        if (typeof next.src === 'string' && next.src.startsWith('data:') && next.src.length > MAX_PERSISTED_DATA_URL_CHARS) {
          delete next.src
        }
        return next
      })
    }
  }
  return copy as unknown as CanvasSurfacePayload
}

/** Whether a surface belongs to the active session (or is globally pinned / unscoped). */
export function isSurfaceVisibleInSession(
  surface: Pick<CanvasSurface, 'pinned' | 'sessionFile'>,
  currentSessionFile: string | null | undefined,
): boolean {
  if (surface.pinned) return true
  if (!surface.sessionFile) return true
  if (!currentSessionFile) return false
  return sessionFilesEqual(surface.sessionFile, currentSessionFile)
}

export function selectVisibleSurfaces(
  surfaces: readonly CanvasSurface[],
  currentSessionFile: string | null | undefined,
  showAllSessions = false,
): CanvasSurface[] {
  if (showAllSessions) return [...surfaces]
  return surfaces.filter((s) => isSurfaceVisibleInSession(s, currentSessionFile))
}

export function selectHiddenSessionCount(
  surfaces: readonly CanvasSurface[],
  currentSessionFile: string | null | undefined,
): number {
  let count = 0
  for (const s of surfaces) {
    if (!isSurfaceVisibleInSession(s, currentSessionFile)) count++
  }
  return count
}

/** Dispatch a consistent quote/attachment payload to the Composer input. */
export function quoteCanvasToComposer(
  text: string,
  files: { path: string; name: string; kind: string }[] = [],
): void {
  if (typeof window === 'undefined') return
  const trimmed = text.trim()
  if (!trimmed && files.length === 0) return
  window.dispatchEvent(
    new CustomEvent('pi-desktop:composer-attach-files', {
      detail: { files, text: trimmed },
    }),
  )
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      surfaces: [],
      activeSurfaceId: null,
      layoutMode: 'single',
      showAllSessions: false,
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
          sessionFile: input.sessionFile !== undefined ? input.sessionFile : (existing?.sessionFile ?? null),
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
        let mergedPayload: CanvasSurfacePayload = existing.payload
        if (isPlainRecord(existing.payload)) {
          let working: Record<string, unknown> = { ...existing.payload }
          if (patch.clearMarkers) {
            working.markers = []
          }
          if (patch.payloadPatch && isPlainRecord(patch.payloadPatch)) {
            working =
              patch.mergeMode === 'deep'
                ? deepMergeRecord(working, patch.payloadPatch)
                : { ...working, ...patch.payloadPatch }
          }
          if (Array.isArray(patch.appendMarkers) && patch.appendMarkers.length > 0) {
            const baseMarkers = Array.isArray(working.markers)
              ? (working.markers as CanvasOverlayMarker[])
              : undefined
            working.markers = upsertOverlayMarkers(baseMarkers, patch.appendMarkers)
          }
          mergedPayload = working as unknown as CanvasSurfacePayload
        }
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

      clearNonPinned: (scopeSessionFile) => {
        const cur = get().surfaces
        const kept = cur.filter((s) => {
          if (s.pinned) return true
          if (scopeSessionFile === undefined) return false
          // Only clear non-pinned surfaces belonging to the requested session (or unscoped).
          return Boolean(s.sessionFile && (!scopeSessionFile || !sessionFilesEqual(s.sessionFile, scopeSessionFile)))
        })
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

      setShowAllSessions: (showAllSessions) => set({ showAllSessions }),

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

      applyAdbFrame: (event) => {
        const cur = get().surfaces
        const hasMatch = cur.some(
          (item) =>
            item.kind === 'device-stream' &&
            (item.payload as CanvasDevicePayload).serial === event.serial,
        )
        if (!hasMatch) return
        set((s) => ({
          surfaces: s.surfaces.map((item) => {
            if (item.kind !== 'device-stream') return item
            const payload = item.payload as CanvasDevicePayload
            if (payload.serial !== event.serial) return item
            const nextResolution =
              event.width && event.height
                ? { width: event.width, height: event.height }
                : payload.resolution
            return {
              ...item,
              payload: {
                ...payload,
                frameDataUrl: event.frameDataUrl,
                resolution: nextResolution,
                fps: event.fps ?? payload.fps,
                status: 'connected',
                error: undefined,
              },
              updatedAt: event.at || Date.now(),
            }
          }),
        }))
      },

      applyAdbStatus: (event) => {
        const cur = get().surfaces
        const hasMatch = cur.some(
          (item) =>
            item.kind === 'device-stream' &&
            (item.payload as CanvasDevicePayload).serial === event.serial,
        )
        if (!hasMatch) return
        set((s) => ({
          surfaces: s.surfaces.map((item) => {
            if (item.kind !== 'device-stream') return item
            const payload = item.payload as CanvasDevicePayload
            if (payload.serial !== event.serial) return item
            return {
              ...item,
              payload: {
                ...payload,
                status: event.status,
                error: event.error,
                ...(event.device?.model ? { deviceName: event.device.model } : {}),
                ...(event.device?.resolution ? { resolution: event.device.resolution } : {}),
                ...(event.device?.battery != null ? { battery: event.device.battery } : {}),
                ...(event.device?.activeApp ? { activeApp: event.device.activeApp } : {}),
              },
              updatedAt: Date.now(),
            }
          }),
        }))
      },
    }),
    {
      name: 'pi-desktop:canvas-state-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        surfaces: s.surfaces.slice(-MAX_PERSISTED_SURFACES).map((item) => ({
          ...item,
          payload: sanitizePayloadForPersist(item.kind, item.payload),
          interactionState: undefined,
        })),
        activeSurfaceId: s.activeSurfaceId,
        layoutMode: s.layoutMode,
      }),
    },
  ),
)

function revealCanvasStage(): void {
  useRightDockStore.getState().activatePanelSmart('canvas')
  useUIStore.getState().revealRightPanel()
}

function isForegroundEvent(eventSessionFile: string | null | undefined): boolean {
  if (!eventSessionFile) return true
  const current = useUIStore.getState().historySessionFile
  if (!current) return true
  return sessionFilesEqual(eventSessionFile, current)
}

async function captureSurfaceScreenshot(
  surfaceId: string | null,
): Promise<{ data: string; mimeType: string } | null> {
  if (!surfaceId || typeof document === 'undefined') return null
  const el =
    document.querySelector<HTMLElement>(`[data-canvas-surface-id="${CSS.escape(surfaceId)}"]`) ??
    document.querySelector<HTMLElement>('[data-pi-slot="ai-canvas-panel"]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 16 || rect.height < 16) return null
  const zoom = Number(document.documentElement.style.zoom) || 1
  try {
    const res = await ipcClient.invoke('canvas.captureSurface', {
      rect: {
        x: Math.max(0, Math.floor(rect.left * zoom)),
        y: Math.max(0, Math.floor(rect.top * zoom)),
        width: Math.ceil(rect.width * zoom),
        height: Math.ceil(rect.height * zoom),
      },
    })
    if (res?.ok && typeof res.data === 'string' && res.data.length > 0) {
      return { data: res.data, mimeType: String(res.mimeType || 'image/jpeg') }
    }
  } catch {
    /* ignore screenshot failure and fall back to text-only canvas_read */
  }
  return null
}

export function handleCanvasToolCallEvent(event: CanvasToolCallEvent): void {
  const store = useCanvasStore.getState()
  const args = event.args ?? {}
  const foreground = isForegroundEvent(event.sessionFile)

  const reply = (
    content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[],
    isError = false,
  ) => {
    void ipcClient
      .invoke('canvas.toolResponse', {
        callId: event.callId,
        isError,
        content,
      })
      .catch(() => {})
  }

  const replyText = (text: string, isError = false) => reply([{ type: 'text', text }], isError)

  try {
    if (event.tool === 'canvas_present') {
      const id = String(args.id ?? '').trim()
      const title = String(args.title ?? '').trim()
      const kind = String(args.kind ?? '') as CanvasSurfaceKind
      if (!id || !title || !VALID_KINDS.has(kind)) {
        replyText('canvas_invalid_args: id, title, and a valid kind are required', true)
        return
      }
      const payload = (args.payload && typeof args.payload === 'object' ? args.payload : {}) as CanvasSurfacePayload
      const wantsFocus = args.focus !== false
      // Background session tool calls persist into their own session slot without stealing foreground focus.
      const shouldFocusForeground = wantsFocus && foreground
      const surface = store.presentSurface({
        id,
        title,
        subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
        kind,
        payload,
        source: 'ai',
        pinned: Boolean(args.pin),
        sessionFile: event.sessionFile ?? useUIStore.getState().historySessionFile ?? null,
        focus: shouldFocusForeground,
      })
      if (shouldFocusForeground) revealCanvasStage()
      replyText(
        JSON.stringify({
          ok: true,
          id: surface.id,
          kind: surface.kind,
          title: surface.title,
          focused: shouldFocusForeground,
          backgrounded: wantsFocus && !foreground,
        }),
      )
      return
    }

    if (event.tool === 'canvas_update') {
      const id = String(args.id ?? '').trim()
      if (!id) {
        replyText('canvas_invalid_args: id is required', true)
        return
      }
      const wantsFocus = Boolean(args.focus)
      const shouldFocusForeground = wantsFocus && foreground
      const updated = store.updateSurface(id, {
        title: typeof args.title === 'string' ? args.title : undefined,
        subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
        payloadPatch:
          args.payloadPatch && typeof args.payloadPatch === 'object'
            ? (args.payloadPatch as Record<string, unknown>)
            : undefined,
        mergeMode: args.mergeMode === 'deep' ? 'deep' : 'shallow',
        appendMarkers: Array.isArray(args.appendMarkers)
          ? (args.appendMarkers as CanvasOverlayMarker[])
          : undefined,
        clearMarkers: Boolean(args.clearMarkers),
        focus: shouldFocusForeground,
      })
      if (!updated) {
        replyText(`canvas_not_found: surface "${id}" does not exist`, true)
        return
      }
      if (shouldFocusForeground) revealCanvasStage()
      replyText(JSON.stringify({ ok: true, id: updated.id, updatedAt: updated.updatedAt }))
      return
    }

    if (event.tool === 'canvas_read') {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const allSessions = args.allSessions === true
      const scopeSession = event.sessionFile ?? useUIStore.getState().historySessionFile ?? null
      const scoped = allSessions
        ? store.surfaces
        : selectVisibleSurfaces(store.surfaces, scopeSession, false)
      const list = id ? scoped.filter((s) => s.id === id) : scoped
      const summary = list.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
        source: s.source,
        pinned: Boolean(s.pinned),
        sessionFile: s.sessionFile ?? null,
        active: s.id === store.activeSurfaceId,
        interactionState: s.interactionState ?? null,
        updatedAt: s.updatedAt,
      }))
      const textPayload = JSON.stringify(
        {
          activeSurfaceId: store.activeSurfaceId,
          scopedSession: allSessions ? 'all' : scopeSession,
          surfaces: summary,
        },
        null,
        2,
      )
      if (args.includeScreenshot === true && foreground) {
        const targetId = id || store.activeSurfaceId || list[0]?.id || null
        void captureSurfaceScreenshot(targetId).then((shot) => {
          if (shot) {
            reply([
              { type: 'text', text: textPayload },
              { type: 'image', data: shot.data, mimeType: shot.mimeType },
            ])
          } else {
            replyText(textPayload)
          }
        })
        return
      }
      replyText(textPayload)
      return
    }

    if (event.tool === 'canvas_close') {
      if (args.all === true) {
        const scopeSession = event.sessionFile ?? useUIStore.getState().historySessionFile ?? null
        const removed = store.clearNonPinned(scopeSession)
        replyText(JSON.stringify({ ok: true, removed }))
        return
      }
      const id = String(args.id ?? '').trim()
      if (!id) {
        replyText('canvas_invalid_args: provide id or all: true', true)
        return
      }
      const removed = store.removeSurface(id)
      replyText(JSON.stringify({ ok: removed, id }))
      return
    }

    replyText(`canvas_unknown_tool: ${event.tool}`, true)
  } catch (error) {
    replyText(`canvas_error: ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

export type { CanvasMarkdownPayload }
