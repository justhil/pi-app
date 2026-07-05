/**
 * hashline-v1 协议检测（由 adapter.toolCard.protocol 声明，不绑定具体 npm 包名）
 */
import { extractToolText, normalizeToolArgs, pathFromArgs } from './tool-output'

const LINE_ANCHOR = /^\s*\d+#[0-9A-F]{2}[│|]/

export function looksLikeHashlineOutput(text: string): boolean {
  if (!text) return false
  const sample = text.slice(0, 8000)
  if (/\d+#[0-9A-F]{2}[│|]/.test(sample)) return true
  if (/^[-+]\d+/m.test(sample) && /[│|]/.test(sample)) return true
  return false
}

/** 是否应按 hashline 协议渲染（输出或参数形态） */
export function shouldRenderHashlineProtocol(
  toolName: string,
  toolOutput: string,
  toolArgs: unknown,
): boolean {
  const args = normalizeToolArgs(toolArgs)
  const text = extractToolText(toolOutput)

  if (toolName === 'insert') return true

  if (toolName === 'read') {
    if (args.raw === true) return false
    return looksLikeHashlineOutput(text)
  }

  if (toolName === 'edit' || toolName === 'grep') {
    if (looksLikeHashlineOutput(text)) return true
    if (toolName === 'edit' && Array.isArray(args.edits)) {
      return args.edits.some((e: { range?: unknown; anchor?: unknown }) => e?.range || e?.anchor)
    }
    return false
  }

  return looksLikeHashlineOutput(text)
}

export function buildHashlineProtocolSummary(toolName: string, args: unknown): string {
  const a = normalizeToolArgs(args)
  if (toolName === 'read' || toolName === 'edit' || toolName === 'insert') {
    const p = pathFromArgs(a)
    if (toolName === 'edit' && Array.isArray(a.edits)) return p ? `${p} · ${a.edits.length} edits` : `${a.edits.length} edits`
    if (toolName === 'insert' && Array.isArray(a.edits)) return p ? `${p} · ${a.edits.length} insert` : `${a.edits.length} insert`
    return p
  }
  if (toolName === 'grep' && a.pattern) return `"${a.pattern}"`
  return ''
}

export function countHashlineAnchorLines(lines: string[]): number {
  return lines.filter((l) => LINE_ANCHOR.test(l.trim())).length
}