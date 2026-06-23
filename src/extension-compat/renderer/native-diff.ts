/** 内置 edit/write diff 解析（A 层，无插件名） */
import { extractToolText, normalizeToolArgs, pathFromArgs } from './tool-output'

export type DiffRow = { kind: 'same' | 'del' | 'add'; old?: string; new?: string }

export function lineDiffRows(oldStr: string, newStr: string): DiffRow[] {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const max = Math.max(oldLines.length, newLines.length)
  const rows: DiffRow[] = []
  for (let i = 0; i < max; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    if (o === n) rows.push({ kind: 'same', old: o, new: n })
    else {
      if (o !== undefined && o !== n) rows.push({ kind: 'del', old: o })
      if (n !== undefined && n !== o) rows.push({ kind: 'add', new: n })
    }
  }
  return rows
}

export function collectEditPairsFromArgs(args: Record<string, any>): { old: string; new: string }[] {
  const pairs: { old: string; new: string }[] = []
  const edits = args.edits
  if (!Array.isArray(edits)) return pairs
  for (const e of edits) {
    if (!e || typeof e !== 'object') continue
    const old =
      e.oldText ?? e.old_text ?? e.oldString ?? e.old_string ?? (Array.isArray(e.lines) && e.op === 'delete' ? e.lines.join('\n') : '')
    const neu =
      e.newText ?? e.new_text ?? e.newString ?? e.new_string ?? (Array.isArray(e.lines) ? e.lines.join('\n') : '')
    if (typeof old === 'string' || typeof neu === 'string') {
      pairs.push({ old: String(old ?? ''), new: String(neu ?? '') })
    }
    if (Array.isArray(e.range) && Array.isArray(e.lines) && e.lines.length && !old && !neu) {
      pairs.push({ old: '…', new: e.lines.join('\n') })
    }
  }
  return pairs
}

export function singleReplaceFromArgs(args: Record<string, any>): { old: string; new: string } | null {
  const old = args.old_string ?? args.oldString ?? args.oldText ?? args.old_text ?? ''
  const neu = args.new_string ?? args.newString ?? args.newText ?? args.new_text ?? args.content ?? ''
  if (!old && !neu) return null
  return { old: String(old), new: String(neu) }
}

function stripHashlinePrefix(line: string): string {
  const t = line.trimStart()
  const m = t.match(/^\d+(?:#[0-9A-F]{2})?[│|](.*)$/)
  if (m) return m[1]
  const m2 = t.match(/^[-+ ]?\d+\s*[│|](.*)$/)
  if (m2) return m2[1]
  return line
}

export function parseUnifiedDiffFromText(text: string): DiffRow[] {
  if (!text) return []
  const rows: DiffRow[] = []
  let sawDiffMarker = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      sawDiffMarker = true
      rows.push({ kind: 'add', new: stripHashlinePrefix(line.slice(1)) })
      continue
    }
    if (line.startsWith('-')) {
      sawDiffMarker = true
      rows.push({ kind: 'del', old: stripHashlinePrefix(line.slice(1)) })
      continue
    }
    if (line.startsWith(' ')) {
      const body = stripHashlinePrefix(line.slice(1))
      rows.push({ kind: 'same', old: body, new: body })
      continue
    }
    if (/^\d+#[0-9A-F]{2}[│|]/.test(line.trim())) {
      const body = stripHashlinePrefix(line)
      rows.push({ kind: 'same', old: body, new: body })
      continue
    }
  }
  if (!sawDiffMarker) return []
  return rows
}

export function parsePatchLines(patch: string): DiffRow[] {
  if (!patch) return []
  const rows: DiffRow[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) rows.push({ kind: 'add', new: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ kind: 'del', old: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ kind: 'same', old: line.slice(1), new: line.slice(1) })
    else if (line.length) rows.push({ kind: 'same', old: line, new: line })
  }
  return rows
}

export function mergeDiffRows(rows: DiffRow[]): DiffRow[] {
  return rows.filter((r) => {
    if (r.kind === 'same') return (r.old ?? '').length > 0 || (r.new ?? '').length > 0
    return true
  })
}

export function hasVisibleDiff(rows: DiffRow[]): boolean {
  return rows.some((r) => r.kind === 'add' || r.kind === 'del')
}

export function fileNameFromArgs(args: Record<string, any>): string {
  const p = pathFromArgs(args)
  return p.split(/[\\/]/).pop() || p || 'file'
}

export function fullPathFromArgs(args: Record<string, any>): string {
  return pathFromArgs(args)
}

export interface NativeDiffSource {
  toolName?: string
  toolArgs?: unknown
  toolOutput?: string
  toolDetails?: any
}

export function resolveEditWriteDiffRows(item: NativeDiffSource): { rows: DiffRow[]; label?: string } | null {
  const args = normalizeToolArgs(item.toolArgs)
  const output = extractToolText(item.toolOutput || '')
  const details = item.toolDetails || {}

  const patch =
    details.patch ||
    args.patch ||
    (output.includes('@@') && output.includes('---') ? output : '')
  if (patch) {
    const rows = parsePatchLines(patch)
    if (hasVisibleDiff(rows)) return { rows, label: 'patch' }
  }

  const unified = parseUnifiedDiffFromText(output)
  if (hasVisibleDiff(unified)) return { rows: unified, label: 'diff' }

  const pairs = collectEditPairsFromArgs(args)
  if (pairs.length) {
    const rows = mergeDiffRows(pairs.flatMap((p) => lineDiffRows(p.old, p.new)))
    if (hasVisibleDiff(rows)) return { rows, label: pairs.length > 1 ? `${pairs.length} edits` : 'edit' }
  }

  const single = singleReplaceFromArgs(args)
  if (single) {
    const rows = lineDiffRows(single.old, single.new)
    if (hasVisibleDiff(rows)) return { rows, label: 'edit' }
  }

  return null
}