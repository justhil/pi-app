// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import { handleCanvasToolCallEvent, useCanvasStore } from '../canvas-store'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
}))

describe('AI Canvas store & tool call protocol', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useCanvasStore.getState().restoreDemos()
    useUIStore.setState({ rightPanelCollapsed: true, activePanel: 'run' })
    useRightDockStore.setState({ bottomTabIds: [], topActive: 'run', bottomActive: null })
  })

  it('projects a new surface via canvas_present, focuses it, reveals Canvas stage, and replies via IPC', () => {
    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-1',
      tool: 'canvas_present',
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
          streamMode: 'screencap',
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

  it('patches an existing surface via canvas_update and reports user interactions via canvas_read', () => {
    useCanvasStore.getState().recordInteraction('adb-pixel-9', { lastTap: { x: 540, y: 1200 } })

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-2',
      tool: 'canvas_update',
      args: {
        id: 'adb-pixel-9',
        subtitle: 'Updated frame',
        payloadPatch: { battery: 91 },
      },
    })

    const updated = useCanvasStore.getState().surfaces.find((s) => s.id === 'adb-pixel-9')
    expect(updated?.subtitle).toBe('Updated frame')
    expect((updated?.payload as { battery?: number }).battery).toBe(91)

    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-3',
      tool: 'canvas_read',
      args: { id: 'adb-pixel-9' },
    })

    const readCall = invokeMock.mock.calls.find((c) => (c[1] as { callId: string }).callId === 'cv-3')
    const replyText = ((readCall?.[1] as { content: { text: string }[] }).content[0]?.text) || ''
    expect(replyText).toContain('"x": 540')
  })

  it('removes surfaces via canvas_close without dropping pinned items when all:true', () => {
    handleCanvasToolCallEvent({
      type: 'canvas-tool-call',
      callId: 'cv-4',
      tool: 'canvas_close',
      args: { all: true },
    })
    const remaining = useCanvasStore.getState().surfaces
    expect(remaining.every((s) => s.pinned)).toBe(true)
    expect(remaining.some((s) => s.id === 'adb-pixel-9')).toBe(true)
  })
})
