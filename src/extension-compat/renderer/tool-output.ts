/** 工具输出/参数解析（兼容层，无插件名） */

export function extractToolText(out: string): string {
  if (!out) return ''
  try {
    const parsed = JSON.parse(out)
    if (Array.isArray(parsed?.content)) {
      return parsed.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text || '').join('\n')
    }
    if (typeof parsed?.text === 'string') return parsed.text
  } catch {
    /* raw */
  }
  return out
}

export function normalizeToolArgs(args: unknown): Record<string, any> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      const p = JSON.parse(args)
      return typeof p === 'object' && p ? p : {}
    } catch {
      return {}
    }
  }
  return typeof args === 'object' ? (args as Record<string, any>) : {}
}

export function pathFromArgs(args: Record<string, any>): string {
  return args.path || args.file_path || ''
}

export function fullPathFromArgs(args: Record<string, any>): string {
  return pathFromArgs(args)
}

export function fileNameFromArgs(args: Record<string, any>): string {
  const p = pathFromArgs(args)
  return p.split(/[\\/]/).pop() || p || 'file'
}