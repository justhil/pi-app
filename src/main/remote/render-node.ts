import { toolCallDetailFromPi } from '@shared/tool-call-detail'
import type { RenderNode, StepStatus, ToolStep } from '@shared/remote'
import type { ToolCardDef } from '../../extension-compat/adapter-schema'
import { applyToolCardFields, extractTextFromToolOutput } from '../../extension-compat/json-path'

/**
 * Tool call → RenderNode for remote clients. Built-in pi tools get dedicated templates via the
 * shared `toolCallDetailFromPi`; everything else goes through the adapter `toolCard` table
 * (template + JSONPath fields resolved here), never through per-plugin branches.
 */

export const PREVIEW_LIMITS = { bash: 4096, edit: 65536, other: 2048 } as const
const MAX_FIELDS_JSON = 16 * 1024

export type ToolCallInput = {
  toolName: string
  args?: unknown
  /** History rows carry text; live `tool` end events carry the raw result envelope. */
  output?: unknown
  details?: unknown
  isError?: boolean
  phase: 'start' | 'update' | 'end'
  statusLine?: string
}

export type ToolCategory = ToolStep['category']

export function toolCategory(toolName: string, card?: ToolCardDef): ToolCategory {
  const detail = toolCallDetailFromPi(toolName, undefined, undefined).type
  if (detail === 'bash') return 'run'
  if (detail === 'read') return 'read'
  if (detail === 'edit') return 'edit'
  if (detail === 'write') return 'write'
  if (detail === 'grep' || detail === 'find' || toolName.toLowerCase() === 'ls') return 'search'
  if (card?.template === 'hashline') return 'edit'
  return 'other'
}

export function outputText(output: unknown): string {
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output)
      const t = extractTextFromToolOutput(parsed)
      if (t) return t
    } catch {
      /* plain text */
    }
    return output
  }
  return extractTextFromToolOutput(output)
}

const countLines = (text: string): number => (text ? text.replace(/\n$/, '').split('\n').length : 0)

/** +/− line counts of an edit/write call (unified diff when present, otherwise the edit pairs). */
export function diffStats(toolName: string, args: unknown, details: unknown): { add: number; del: number; diff?: string } | null {
  const detail = toolCallDetailFromPi(toolName, args, details)
  if (detail.type === 'write') {
    const content = typeof (args as { content?: unknown })?.content === 'string' ? (args as { content: string }).content : ''
    return { add: countLines(content), del: 0 }
  }
  if (detail.type !== 'edit') return null
  if (detail.diff) {
    let add = 0
    let del = 0
    for (const line of detail.diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) add++
      else if (line.startsWith('-')) del++
    }
    return { add, del, diff: detail.diff }
  }
  let add = 0
  let del = 0
  for (const e of detail.edits ?? []) {
    add += countLines(e.newText)
    del += countLines(e.oldText)
  }
  return { add, del }
}

/** Edit pairs without pi's diff (older sessions, some adapters): `-old` / `+new` lines, ` ...` between pairs. */
function pairsAsDiff(edits: { oldText: string; newText: string }[] | undefined): string {
  const lines = (t: string) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'))
  return (edits ?? [])
    .map((e) => [...lines(e.oldText).map((l) => `-${l}`), ...lines(e.newText).map((l) => `+${l}`)].join('\n'))
    .filter(Boolean)
    .join('\n ...\n')
}

function clip(text: string, limit: number, fromEnd = false): { text: string; clipped: boolean } {
  if (text.length <= limit) return { text, clipped: false }
  return { text: fromEnd ? text.slice(text.length - limit) : text.slice(0, limit), clipped: true }
}

function safeFields(fields: Record<string, unknown>): { fields: Record<string, unknown>; clipped: boolean } {
  try {
    const json = JSON.stringify(fields)
    if (json.length <= MAX_FIELDS_JSON) return { fields: JSON.parse(json), clipped: false }
  } catch {
    /* non-serializable */
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 1024)
  }
  return { fields: out, clipped: true }
}

const firstLine = (s: string, max = 160) => {
  const line = s.split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function statusOf(input: ToolCallInput): StepStatus {
  if (input.phase !== 'end') return 'running'
  return input.isError ? 'error' : 'ok'
}

export function buildRenderNode(input: ToolCallInput, card?: ToolCardDef): RenderNode {
  const status = statusOf(input)
  const text = input.phase === 'end' ? outputText(input.output) : input.statusLine ?? ''
  const detail = toolCallDetailFromPi(input.toolName, input.args, input.details ?? text)
  const name = input.toolName

  switch (detail.type) {
    case 'bash': {
      const out = clip(outputText(input.output) || text, PREVIEW_LIMITS.bash, true)
      const exitCode = (input.details as { exitCode?: unknown } | undefined)?.exitCode
      return {
        template: 'bash',
        title: firstLine(detail.command) || name,
        status,
        fields: { command: detail.command, ...(typeof exitCode === 'number' ? { exitCode } : {}) },
        ...(out.text ? { preview: out.text } : {}),
        ...(out.clipped ? { detail: true } : {}),
        fallbackText: `${name} ${firstLine(detail.command, 80)}`.trim(),
      }
    }
    case 'read': {
      const out = clip(text, PREVIEW_LIMITS.other)
      return {
        template: 'read',
        title: detail.path || name,
        status,
        fields: { path: detail.path, ...(detail.offset != null ? { offset: detail.offset } : {}), ...(detail.limit != null ? { limit: detail.limit } : {}) },
        ...(out.text ? { preview: out.text } : {}),
        ...(out.clipped ? { detail: true } : {}),
        fallbackText: `${name} ${detail.path}`.trim(),
      }
    }
    case 'edit':
    case 'write': {
      const stats = diffStats(name, input.args, input.details) ?? { add: 0, del: 0 }
      const source = detail.type === 'write' ? detail.preview ?? '' : stats.diff ?? pairsAsDiff(detail.edits)
      const out = clip(source, detail.type === 'write' ? PREVIEW_LIMITS.other : PREVIEW_LIMITS.edit)
      return {
        template: detail.type,
        title: detail.path || name,
        status,
        fields: { path: detail.path, add: stats.add, ...(detail.type === 'edit' ? { del: stats.del } : {}) },
        ...(out.text ? { preview: out.text } : {}),
        ...(out.clipped ? { detail: true } : {}),
        fallbackText: `${name} ${detail.path} +${stats.add}${detail.type === 'edit' ? ` −${stats.del}` : ''}`.trim(),
      }
    }
    case 'grep':
    case 'find': {
      const out = clip(text, PREVIEW_LIMITS.other)
      return {
        template: 'search',
        title: detail.pattern || name,
        status,
        fields: { kind: detail.type, pattern: detail.pattern, ...(detail.path ? { path: detail.path } : {}) },
        ...(out.text ? { preview: out.text } : {}),
        ...(out.clipped ? { detail: true } : {}),
        fallbackText: `${name} ${detail.pattern}`.trim(),
      }
    }
    default: {
      const mapped = card?.fields ? applyToolCardFields({ args: input.args, details: input.details, output: input.output }, card.fields) : {}
      const { fields, clipped: fieldsClipped } = safeFields(mapped)
      const out = clip(text, PREVIEW_LIMITS.other)
      const template = card?.template && card.template !== 'hashline' ? card.template : 'default'
      return {
        template,
        title: typeof fields.title === 'string' && fields.title ? fields.title : name,
        ...(card?.icon ? { icon: card.icon } : {}),
        status,
        fields,
        ...(out.text ? { preview: out.text } : {}),
        ...(out.clipped || fieldsClipped ? { detail: true } : {}),
        fallbackText: name,
      }
    }
  }
}
