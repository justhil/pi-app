export const CANVAS_EVENT_CHANNEL = 'ipc:canvas-event'

export type CanvasSurfaceKind =
  | 'device-stream'
  | 'delegation-tree'
  | 'ui-block'
  | 'html'
  | 'diagram'
  | 'markdown'
  | 'image'

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

export type CanvasDeviceStreamMode = 'adb-screencap' | 'mjpeg' | 'ws-frames' | 'manual' | 'screencap'

export interface CanvasDevicePayload {
  deviceName: string
  serial: string
  platform: 'android' | 'ios' | 'desktop'
  resolution: { width: number; height: number }
  orientation?: 'portrait' | 'landscape'
  streamMode: CanvasDeviceStreamMode
  streamUrl?: string
  frameDataUrl?: string
  autoStream?: boolean
  intervalMs?: number
  controlMode?: 'control' | 'annotate'
  fps?: number
  battery?: number
  activeApp?: string
  status: 'connected' | 'connecting' | 'paused' | 'disconnected' | 'error'
  error?: string
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
  kind?: 'session' | 'batch' | 'chain-step' | 'agent'
  stepIndex?: number
  task: string
  state: CanvasDelegationNodeState
  toolCount?: number
  tokens?: number
  durationMs?: number
  startedAt?: number
  activeTool?: string
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
  /** 'html' (default) or 'react' (JSX/TSX + Tailwind offline compilation). Auto-detected when omitted. */
  mode?: 'html' | 'react'
  html?: string
  /** Alias for `html` when presenting JSX/TSX React components. */
  code?: string
  css?: string
  /** Optional multi-file virtual modules for React prototypes (e.g. { './Card.tsx': '...' }). */
  files?: Record<string, string>
  /** Compile real Tailwind CSS utilities offline for HTML & React prototypes (default true). */
  tailwind?: boolean
  title?: string
  filePath?: string
  watch?: boolean
  viewport?: 'auto' | 'mobile' | 'tablet' | 'desktop'
  allowScripts?: boolean
}

export interface CanvasDiagramPayload {
  format: 'mermaid' | 'svg'
  code?: string
  filePath?: string
  watch?: boolean
  caption?: string
}

export interface CanvasMarkdownPayload {
  markdown?: string
  filePath?: string
  watch?: boolean
}

export interface CanvasImageItem {
  id?: string
  src?: string
  filePath?: string
  label?: string
  caption?: string
}

export interface CanvasImagePayload {
  mode?: 'single' | 'compare' | 'gallery'
  src?: string
  filePath?: string
  alt?: string
  caption?: string
  watch?: boolean
  compareSrc?: string
  compareFilePath?: string
  leftLabel?: string
  rightLabel?: string
  images?: CanvasImageItem[]
}

export type CanvasSurfacePayload =
  | CanvasDevicePayload
  | CanvasDelegationPayload
  | CanvasUiBlockPayload
  | CanvasHtmlPayload
  | CanvasDiagramPayload
  | CanvasMarkdownPayload
  | CanvasImagePayload

export interface CanvasSurface {
  id: string
  title: string
  subtitle?: string
  kind: CanvasSurfaceKind
  payload: CanvasSurfacePayload
  source: 'ai' | 'user'
  pinned?: boolean
  sessionFile?: string | null
  badge?: string
  createdAt: number
  updatedAt: number
  interactionState?: Record<string, unknown>
}

export interface AdbDeviceInfo {
  serial: string
  state: string
  model?: string
  product?: string
  device?: string
  transportId?: string
  resolution?: { width: number; height: number }
  battery?: number
  activeApp?: string
}

export interface CanvasToolCallEvent {
  type: 'canvas-tool-call'
  callId: string
  tool: string
  args: Record<string, unknown>
  sessionFile?: string | null
  cwd?: string | null
}

export interface CanvasAdbFrameEvent {
  type: 'canvas-adb-frame'
  serial: string
  frameDataUrl: string
  width?: number
  height?: number
  fps?: number
  at: number
}

export interface CanvasAdbStatusEvent {
  type: 'canvas-adb-status'
  serial: string
  status: 'connected' | 'connecting' | 'paused' | 'disconnected' | 'error'
  error?: string
  device?: Partial<AdbDeviceInfo>
}

export interface CanvasFileChangedEvent {
  type: 'canvas-file-changed'
  watchId: string
  filePath: string
  content?: string
  dataUrl?: string
  mtimeMs?: number
  error?: string
}

export type CanvasEvent =
  | CanvasToolCallEvent
  | CanvasAdbFrameEvent
  | CanvasAdbStatusEvent
  | CanvasFileChangedEvent
