/** 工具输出/参数解析（兼容层，无插件名） */

export function extractToolText(out: string): string {
  if (!out) return ''
  try {
    const parsed = JSON.parse(out)
    if (Array.isArray(parsed?.content)) {
      return parsed.content
        .filter((c: { type?: string }) => c?.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join('\n')
    }
    if (typeof parsed?.text === 'string') return parsed.text
  } catch (e) {
    /* raw */
  }
  return out
}

export function normalizeToolArgs(args: unknown): Record<string, unknown> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      const p = JSON.parse(args)
      return typeof p === 'object' && p ? p : {}
    } catch (e) {
      return {}
    }
  }
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

export function pathFromArgs(args: Record<string, unknown>): string {
  return String(args.path || args.file_path || '')
}

export function fullPathFromArgs(args: Record<string, unknown>): string {
  return pathFromArgs(args)
}

export function fileNameFromArgs(args: Record<string, unknown>): string {
  const p = pathFromArgs(args)
  return p.split(/[\\/]/).pop() || p || 'file'
}