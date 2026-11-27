export const CANVAS_EVENT_CHANNEL = 'ipc:canvas-event'

export type CanvasSurfaceKind =
  | 'device-stream'
  | 'delegation-tree'
  | 'ui-block'
  | 'html'
  | 'diagram'
  | 'markdown'

export interface CanvasOverlayMarker {
  id: string
  kind: 'tap' | 'box' | 'label'
  /** Normalized 0..1 coordinates relative to surface width/height, or pixel coords when unit === 'px'. */
  x: number
  y: number
  w?: number
  h?: number
  unit?: 'ratio' | 'px'
  label?: string
  color?: string
  at?: number
}

export interface CanvasDevicePayload {
  deviceName: string
  serial: string
  platform: 'android' | 'ios' | 'desktop'
  resolution: { width: number; height: number }
  orientation?: 'portrait' | 'landscape'
  streamMode: 'mock-adb' | 'mjpeg' | 'ws-frames' | 'screencap'
  streamUrl?: string
  frameDataUrl?: string
  fps?: number
  battery?: number
  activeApp?: string
  status: 'connected' | 'connecting' | 'mock' | 'disconnected'
  interactive?: boolean
  markers?: CanvasOverlayMarker[]
  lastAction?: string
}

export type CanvasDelegationNodeState = 'pending' | 'running' | 'completed' | 'failed' | 'detached' | 'unknown'

export interface CanvasDelegationNode {
  id: string
  parentId?: string | null
  agent: string
  role?: string
  task: string
  state: CanvasDelegationNodeState
  toolCount?: number
  tokens?: number
  durationMs?: number
  model?: string
  outputPreview?: string
  sessionFile?: string
  error?: string
}

export interface CanvasDelegationPayload {
  source: 'live' | 'snapshot'
  title?: string
  summary?: string
  nodes?: CanvasDelegationNode[]
}

export interface CanvasUiBlockPayload {
  component: string
  props: Record<string, unknown>
  caption?: string
}

export interface CanvasHtmlPayload {
  html: string
  css?: string
  title?: string
  allowScripts?: boolean
}

export interface CanvasDiagramPayload {
  format: 'mermaid' | 'svg'
  code: string
  caption?: string
}

export interface CanvasMarkdownPayload {
  markdown: string
}

export type CanvasSurfacePayload =
  | CanvasDevicePayload
  | CanvasDelegationPayload
  | CanvasUiBlockPayload
  | CanvasHtmlPayload
  | CanvasDiagramPayload
  | CanvasMarkdownPayload

export interface CanvasSurface {
  id: string
  title: string
  subtitle?: string
  kind: CanvasSurfaceKind
  payload: CanvasSurfacePayload
  source: 'ai' | 'user' | 'demo'
  pinned?: boolean
  sessionFile?: string | null
  badge?: string
  createdAt: number
  updatedAt: number
  interactionState?: Record<string, unknown>
}

export interface CanvasToolCallEvent {
  type: 'canvas-tool-call'
  callId: string
  tool: string
  args: Record<string, unknown>
  sessionFile?: string | null
}

export type CanvasEvent = CanvasToolCallEvent
