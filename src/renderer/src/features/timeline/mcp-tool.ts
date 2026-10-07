// MCP tool calls in the timeline: pi registers server tools as `mcp__<server>__<tool>`
// (names sanitized to [A-Za-z0-9_]) and puts the real `{ server, tool }` in the result details.
// The resource tools are shared across servers and name the server in their `server` argument.
import { normalizeToolArgs } from '@extension-compat/renderer/tool-output'

export interface McpToolRef {
  server: string
  tool: string
}

const MCP_TOOL_NAME = /^mcp__(.+?)__(.+)$/
const MCP_RESOURCE_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])

export function isMcpToolName(toolName: string | undefined): boolean {
  return !!toolName && (MCP_TOOL_NAME.test(toolName) || MCP_RESOURCE_TOOLS.has(toolName))
}

export function resolveMcpTool(toolName: string | undefined, details?: unknown, args?: unknown): McpToolRef | null {
  if (!toolName) return null
  if (MCP_RESOURCE_TOOLS.has(toolName)) {
    const server = normalizeToolArgs(args).server
    return { server: typeof server === 'string' && server ? server : 'mcp', tool: toolName }
  }
  const match = MCP_TOOL_NAME.exec(toolName)
  if (!match) return null
  const d = details as { server?: unknown; tool?: unknown } | null | undefined
  if (d && typeof d.server === 'string' && typeof d.tool === 'string') return { server: d.server, tool: d.tool }
  return { server: match[1], tool: match[2] }
}

export function mcpToolLabel(ref: McpToolRef): string {
  return `${ref.server}/${ref.tool}`
}

/** Display name for a tool in summaries: `server/tool` for MCP, the name otherwise. */
export function displayToolName(toolName: string | undefined): string {
  const ref = resolveMcpTool(toolName)
  return ref ? mcpToolLabel(ref) : toolName || 'tool'
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** One-line argument summary: the first short string value, else `key=value` pairs. */
export function mcpArgSummary(args: unknown, max = 72): string {
  const a = normalizeToolArgs(args)
  const entries = Object.entries(a).filter(([key]) => key !== 'server')
  for (const key of ['query', 'q', 'uri', 'url', 'path', 'name', 'title']) {
    const text = scalarText(a[key])
    if (text) return clip(text, max)
  }
  const parts: string[] = []
  for (const [key, value] of entries) {
    const text = scalarText(value)
    if (text === null || !text) continue
    parts.push(`${key}=${text}`)
    if (parts.join(' ').length >= max) break
  }
  return clip(parts.join(' '), max)
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** Pretty JSON when the text is a JSON object or array; otherwise the text as is. */
export function formatMcpOutput(text: string): { code: string; lang?: string } {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { code: JSON.stringify(JSON.parse(trimmed), null, 2), lang: 'json' }
    } catch {
      /* not JSON */
    }
  }
  return { code: text }
}
