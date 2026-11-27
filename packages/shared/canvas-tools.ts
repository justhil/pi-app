export const CANVAS_NAMESPACE = {
  name: 'canvas',
  description:
    'pi Desktop right-side AI Canvas: project interactive ui-blocks, live delegation trees, ADB device screens, images/comparisons, mermaid/svg diagrams, markdown docs, and HTML sandboxes',
}

export interface CanvasToolDef {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
}

export const CANVAS_TOOL_DEFS: readonly CanvasToolDef[] = [
  {
    name: 'canvas_present',
    label: 'Present on Canvas',
    description:
      'Project or replace an interactive surface on the pi Desktop right-side AI Canvas (ui-block, delegation-tree, device-stream, image, html, diagram, or markdown). Supports local filePath with optional watch hot-reload to avoid sending large content inline.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Stable kebab-case identifier for this surface (reusing an id updates it in place).',
        },
        title: {
          type: 'string',
          description: 'Short tab title shown in the Canvas header.',
        },
        subtitle: {
          type: 'string',
          description: 'Optional concise status or source caption.',
        },
        kind: {
          type: 'string',
          enum: ['ui-block', 'delegation-tree', 'device-stream', 'image', 'html', 'diagram', 'markdown'],
          description: 'Surface renderer type.',
        },
        payload: {
          type: 'object',
          description:
            'Kind-specific payload: ui-block {component, props}; delegation-tree {source:"live"|"snapshot", nodes?}; device-stream {deviceName, serial, platform, resolution, streamMode:"adb-screencap"|"mjpeg"|"ws-frames"|"manual", autoStream?, streamUrl?, frameDataUrl?, controlMode?, markers?}; image {mode?:"single"|"compare"|"gallery", src?, filePath?, compareFilePath?, images?, watch?}; html {mode?:"html"|"react", html?, code?, css?, files?, tailwind?, filePath?, watch?, viewport?} (offline JSX/TSX + Tailwind + lucide-react supported); diagram {format:"mermaid"|"svg", code?, filePath?, watch?}; markdown {markdown?, filePath?, watch?}.',
        },
        focus: {
          type: 'boolean',
          description: 'Bring this surface to focus and reveal the Canvas stage in the active session (default true).',
        },
        pin: {
          type: 'boolean',
          description: 'Keep this surface visible across session switches (useful for live device screens).',
        },
      },
      required: ['id', 'title', 'kind', 'payload'],
    },
  },
  {
    name: 'canvas_update',
    label: 'Update Canvas Surface',
    description:
      'Incrementally patch an existing Canvas surface (shallow or deep merge payloadPatch, append/clear device markers, or change title/subtitle) without recreating it.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Surface id to update.' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        payloadPatch: {
          type: 'object',
          description: 'Patch applied onto the surface payload.',
        },
        mergeMode: {
          type: 'string',
          enum: ['shallow', 'deep'],
          description: 'Merge strategy for payloadPatch (default shallow; use deep for nested props).',
        },
        appendMarkers: {
          type: 'array',
          description: 'For device-stream surfaces: upsert overlay markers by id without resending all markers.',
        },
        clearMarkers: {
          type: 'boolean',
          description: 'For device-stream surfaces: clear existing markers before applying patch/appendMarkers.',
        },
        focus: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'canvas_read',
    label: 'Read Canvas State',
    description:
      'Inspect open surfaces in the current session, user interaction state (tapped/swiped coordinates, selected node, sandbox HTML events/runtimeErrors), and optionally capture a visual screenshot for self-check.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional surface id; omit to list surfaces visible in the current session.',
        },
        includeScreenshot: {
          type: 'boolean',
          description: 'When true, capture a compressed screenshot of the target (or active) visible surface and return it as an image for visual verification.',
        },
        allSessions: {
          type: 'boolean',
          description: 'Include surfaces belonging to other sessions (default false).',
        },
      },
    },
  },
  {
    name: 'canvas_close',
    label: 'Close Canvas Surface',
    description: 'Close one surface by id, or clear all non-pinned surfaces in the current session when all is true.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Surface id to remove.' },
        all: { type: 'boolean', description: 'Remove all non-pinned surfaces in the current session.' },
      },
    },
  },
] as const

export const CANVAS_TOOL_NAMES: readonly string[] = CANVAS_TOOL_DEFS.map((d) => d.name)
