// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import {
  handleCanvasToolCallEvent,
  selectHiddenSessionCount,
  selectVisibleSurfaces,
  useCanvasStore,
} from '../canvas-store'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
}))

describe('AI Canvas store & tool call protocol', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
    useCanvasStore.setState({
      surfaces: [],
      activeSurfaceId: null,
      layoutMode: 'single',
      showAllSessions: false,
      protocolDrawerOpen: false,
    })
    useUIStore.setState({
      rightPanelCollapsed: true,
      activePanel: 'run',
      historySessionFile: '/sessions/s1.jsonl',
      browserChatExpand: false,
      canvasChatExpand: false,
    })
    useRightDockStore.setState({ bottomTabIds: [], topActive: 'run', bottomActive: null })
  })

  it('starts empty without placeholder demo surfaces', () => {
    const state = useCanvasStore.getState()
    expect(state.surfaces).toEqual([])
    expect(state.activeSurfaceId).toBeNull()
  })

  it('projects a new surface via canvas_present, focuses it, reveals Canvas stage, and replies via IPC', () => {
    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-1',
      tool: 'canvas_present',
      sessionFile: '/sessions/s1.jsonl',
      args: {
        id: 'live-adb',
        title: 'Mi 15 ADB',
        kind: 'device-stream',
        pin: true,
        payload: {
          deviceName: 'Mi 15',
          serial: 'adb-01',
          platform: 'android',
          resolution: { width: 1200, height: 2670 },
          streamMode: 'adb-screencap',
          status: 'connected',
        },
      },
    })

    const state = useCanvasStore.getState()
    expect(state.activeSurfaceId).toBe('live-adb')
    expect(state.surfaces.find((s) => s.id === 'live-adb')).toMatchObject({
      title: 'Mi 15 ADB',
      kind: 'device-stream',
      pinned: true,
      source: 'ai',
    })
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(invokeMock).toHaveBeenCalledWith(
      'canvas.toolResponse',
      expect.objectContaining({ callId: 'cv-1', isError: false }),
    )
  })

  it('prevents background sessions from stealing foreground Canvas focus and isolates surfaces per session', () => {
    useCanvasStore.getState().presentSurface({
      id: 'fg-doc',
      title: 'Foreground Doc',
      kind: 'markdown',
      sessionFile: '/sessions/s1.jsonl',
      payload: { markdown: '# Active' },
    })
    useUIStore.setState({ rightPanelCollapsed: true, historySessionFile: '/sessions/s1.jsonl' })

    // Background session s2 projects a surface with focus: true -> must NOT hijack foreground right dock or activeSurfaceId!
    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-bg',
      tool: 'canvas_present',
      sessionFile: '/sessions/s2.jsonl',
      args: {
        id: 'bg-chart',
        title: 'Background Chart',
        kind: 'markdown',
        focus: true,
        payload: { markdown: '# Background' },
      },
    })

    const state = useCanvasStore.getState()
    expect(state.activeSurfaceId).toBe('fg-doc')
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)

    const visibleS1 = selectVisibleSurfaces(state.surfaces, '/sessions/s1.jsonl', false)
    expect(visibleS1.map((s) => s.id)).toEqual(['fg-doc'])
    expect(selectHiddenSessionCount(state.surfaces, '/sessions/s1.jsonl')).toBe(1)

    // Pinned surfaces stay visible across sessions.
    useCanvasStore.getState().togglePinSurface('bg-chart')
    expect(selectVisibleSurfaces(useCanvasStore.getState().surfaces, '/sessions/s1.jsonl', false).map((s) => s.id)).toEqual([
      'fg-doc',
      'bg-chart',
    ])
  })

  it('supports deep payloadPatch, marker upsert/clear, and ADB live frame updates', () => {
    useCanvasStore.getState().presentSurface({
      id: 'stats-1',
      title: 'Stats',
      kind: 'ui-block',
      sessionFile: '/sessions/s1.jsonl',
      payload: {
        component: 'stat-grid',
        props: { title: 'Metrics', items: [{ label: 'QPS', value: '120' }] },
      },
    })

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-deep',
      tool: 'canvas_update',
      sessionFile: '/sessions/s1.jsonl',
      args: {
        id: 'stats-1',
        mergeMode: 'deep',
        payloadPatch: { props: { title: 'Updated Metrics' } },
      },
    })

    const statsPayload = useCanvasStore.getState().surfaces.find((s) => s.id === 'stats-1')?.payload as {
      props: { title: string; items: unknown[] }
    }
    expect(statsPayload.props.title).toBe('Updated Metrics')
    expect(statsPayload.props.items).toHaveLength(1)

    useCanvasStore.getState().presentSurface({
      id: 'dev-1',
      title: 'Pixel',
      kind: 'device-stream',
      pinned: true,
      payload: {
        deviceName: 'Pixel',
        serial: 'pixel-9',
        platform: 'android',
        resolution: { width: 1080, height: 2400 },
        streamMode: 'adb-screencap',
        status: 'connecting',
        markers: [{ id: 'm1', kind: 'tap', x: 0.2, y: 0.3 }],
      },
    })

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-markers',
      tool: 'canvas_update',
      sessionFile: '/sessions/s1.jsonl',
      args: {
        id: 'dev-1',
        appendMarkers: [
          { id: 'm1', kind: 'tap', x: 0.5, y: 0.6, label: 'Moved' },
          { id: 'm2', kind: 'box', x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
        ],
      },
    })

    const devAfterMarkers = useCanvasStore.getState().surfaces.find((s) => s.id === 'dev-1')?.payload as {
      markers?: { id: string; x: number; label?: string }[]
      frameDataUrl?: string
      fps?: number
      status?: string
    }
    expect(devAfterMarkers.markers).toHaveLength(2)
    expect(devAfterMarkers.markers?.find((m) => m.id === 'm1')).toMatchObject({ x: 0.5, label: 'Moved' })

    useCanvasStore.getState().applyAdbFrame({
      type: 'canvas-adb-frame',
      serial: 'pixel-9',
      frameDataUrl: 'data:image/png;base64,AAAA',
      width: 1080,
      height: 2400,
      fps: 3.2,
      at: Date.now(),
    })

    const devAfterFrame = useCanvasStore.getState().surfaces.find((s) => s.id === 'dev-1')?.payload as {
      frameDataUrl?: string
      fps?: number
      status?: string
    }
    expect(devAfterFrame.frameDataUrl).toBe('data:image/png;base64,AAAA')
    expect(devAfterFrame.fps).toBe(3.2)
    expect(devAfterFrame.status).toBe('connected')
  })

  it('captures a compressed screenshot when canvas_read specifies includeScreenshot:true', async () => {
    useCanvasStore.getState().presentSurface({
      id: 'proto-1',
      title: 'Proto',
      kind: 'html',
      sessionFile: '/sessions/s1.jsonl',
      payload: { html: '<p>Hi</p>' },
    })

    const host = document.createElement('div')
    host.setAttribute('data-canvas-surface-id', 'proto-1')
    host.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 420, height: 600, right: 520, bottom: 650, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(host)

    invokeMock.mockImplementation(async (channel: unknown) => {
      if (channel === 'canvas.captureSurface') {
        return { ok: true, data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg' }
      }
      return { ok: true }
    })

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-shot',
      tool: 'canvas_read',
      sessionFile: '/sessions/s1.jsonl',
      args: { id: 'proto-1', includeScreenshot: true },
    })

    await vi.waitFor(() => {
      const reply = invokeMock.mock.calls.find(
        (c) => c[0] === 'canvas.toolResponse' && (c[1] as { callId: string }).callId === 'cv-shot',
      )
      expect(reply).toBeDefined()
      const content = (reply?.[1] as { content: { type: string; data?: string }[] }).content
      expect(content).toHaveLength(2)
      expect(content[1]).toEqual({ type: 'image', data: 'ZmFrZS1qcGVn', mimeType: 'image/jpeg' })
    })

    host.remove()
  })

  it('removes only current-session non-pinned surfaces on canvas_close(all:true)', () => {
    useCanvasStore.getState().presentSurface({
      id: 'pinned-1',
      title: 'Pinned View',
      kind: 'markdown',
      pinned: true,
      sessionFile: '/sessions/s1.jsonl',
      payload: { markdown: 'keep' },
    })
    useCanvasStore.getState().presentSurface({
      id: 'temp-s1',
      title: 'Temp S1',
      kind: 'markdown',
      pinned: false,
      sessionFile: '/sessions/s1.jsonl',
      payload: { markdown: 'drop' },
    })
    useCanvasStore.getState().presentSurface({
      id: 'temp-s2',
      title: 'Temp S2',
      kind: 'markdown',
      pinned: false,
      sessionFile: '/sessions/s2.jsonl',
      payload: { markdown: 'keep other session' },
    })

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-4',
      tool: 'canvas_close',
      sessionFile: '/sessions/s1.jsonl',
      args: { all: true },
    })
    const remainingIds = useCanvasStore.getState().surfaces.map((s) => s.id)
    expect(remainingIds).toEqual(['pinned-1', 'temp-s2'])
  })
})
