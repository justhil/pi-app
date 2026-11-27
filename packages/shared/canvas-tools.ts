export const CANVAS_NAMESPACE = {
  name: 'canvas',
  description:
    'pi Desktop right-side AI Canvas: project interactive ui-blocks, live delegation trees, ADB device screens, mermaid/svg diagrams, and HTML sandboxes',
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
      'Project or replace an interactive surface on the pi Desktop right-side AI Canvas (charts/tables via ui-block, live delegation-tree, ADB device-stream, mermaid/svg diagram, sandboxed html, or markdown). Automatically reveals the Canvas when focus is true.',
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
          enum: ['ui-block', 'delegation-tree', 'device-stream', 'html', 'diagram', 'markdown'],
          description: 'Surface renderer type.',
        },
        payload: {
          type: 'object',
          description:
            'Kind-specific payload: ui-block {component, props}, delegation-tree {source: "live"|"snapshot", nodes?}, device-stream {deviceName, serial, platform, resolution, streamMode, frameDataUrl?, markers?}, html {html, css?}, diagram {format: "mermaid"|"svg", code}, markdown {markdown}.',
        },
        focus: {
          type: 'boolean',
          description: 'Bring this surface to focus and reveal the Canvas stage (default true).',
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
      'Incrementally patch an existing Canvas surface (merge payload fields, update markers on a device screen, or change title/subtitle) without recreating it.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Surface id to update.' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        payloadPatch: {
          type: 'object',
          description: 'Shallow merge patch applied onto the surface payload.',
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
      'Inspect open surfaces on the AI Canvas and any user interaction state (such as tapped device coordinates, selected delegation node, or sandboxed HTML events).',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional surface id; omit to list all surfaces in the current session.',
        },
      },
    },
  },
  {
    name: 'canvas_close',
    label: 'Close Canvas Surface',
    description: 'Close one surface by id, or clear all non-pinned surfaces when all is true.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Surface id to remove.' },
        all: { type: 'boolean', description: 'Remove all non-pinned surfaces.' },
      },
    },
  },
] as const

export const CANVAS_TOOL_NAMES: readonly string[] = CANVAS_TOOL_DEFS.map((d) => d.name)
