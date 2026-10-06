import type { DiffFile, DiffLine } from '@shared/remote'

/** Lines sent for one file; longer diffs come back with `truncated`. */
export const DIFF_LINES_MAX = 4000
const LINE_CHARS_MAX = 2000

export type ParsedDiffFile = DiffFile & { lines: DiffLine[] }

const clipLine = (s: string) => (s.length > LINE_CHARS_MAX ? `${s.slice(0, LINE_CHARS_MAX)}…` : s)

function unquote(path: string): string {
  if (!path.startsWith('"')) return path
  try {
    // git quotes paths with C escapes (octal bytes for non-ASCII).
    const bytes: number[] = []
    const body = path.slice(1, -1)
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c !== '\\') {
        bytes.push(...new TextEncoder().encode(c))
        continue
      }
      const next = body[++i]
      if (/[0-7]/.test(next)) {
        bytes.push(parseInt(body.slice(i, i + 3), 8))
        i += 2
      } else bytes.push(({ n: 10, t: 9, '"': 34, '\\': 92 } as Record<string, number>)[next] ?? next.charCodeAt(0))
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  } catch {
    return path
  }
}

const stripPrefix = (p: string) => unquote(p).replace(/^[ab]\//, '')

/** Parse `git diff` output into per-file stats and display lines. */
export function parseUnifiedDiff(raw: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = []
  let cur: ParsedDiffFile | null = null
  let o = 0
  let n = 0
  let inHunk = false
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (".*?"|\S+) (".*?"|\S+)$/.exec(line)
      cur = { path: m ? stripPrefix(m[2]) : line.slice(11), add: 0, del: 0, status: 'modified', lines: [] }
      files.push(cur)
      inHunk = false
      continue
    }
    if (!cur) continue
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added'
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted'
      else if (line.startsWith('rename to ')) {
        cur.status = 'renamed'
        cur.path = unquote(line.slice(10))
      } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) cur.status = 'binary'
      else if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) cur.path = stripPrefix(line.slice(4))
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (hunk) {
      if (cur.lines.length) cur.lines.push({ k: 'gap', s: hunk[3].trim() })
      o = Number(hunk[1])
      n = Number(hunk[2])
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      cur.add++
      cur.lines.push({ k: 'add', n: n++ || undefined, s: clipLine(line.slice(1)) })
    } else if (line.startsWith('-')) {
      cur.del++
      cur.lines.push({ k: 'del', o: o++ || undefined, s: clipLine(line.slice(1)) })
    } else if (line.startsWith(' ')) {
      cur.lines.push({ k: 'ctx', o: o++ || undefined, n: n++ || undefined, s: clipLine(line.slice(1)) })
    }
  }
  for (const f of files) for (const l of f.lines) for (const key of ['o', 'n'] as const) if (l[key] === undefined) delete l[key]
  return files
}

/**
 * pi's edit diff (`+12 text`, `-12 text`, ` 12 text`, ` … ...` between chunks; see pi
 * `generateDiffString`), or `-old` / `+new` lines synthesized from edit pairs. Context lines carry
 * the old line number.
 */
export function parsePiDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const line of text.split('\n')) {
    const m = /^([+\- ])\s*(\d+) (.*)$/.exec(line)
    if (m) {
      const num = Number(m[2]) || undefined
      const s = clipLine(m[3])
      if (m[1] === '+') out.push(num ? { k: 'add', n: num, s } : { k: 'add', s })
      else if (m[1] === '-') out.push(num ? { k: 'del', o: num, s } : { k: 'del', s })
      else out.push(num ? { k: 'ctx', o: num, s } : { k: 'ctx', s })
    } else if (/^ \s*\.\.\.$/.test(line)) out.push({ k: 'gap', s: '' })
    // Synthesized from edit pairs (no line numbers): `-old` / `+new`.
    else if (line.startsWith('+') || line.startsWith('-')) out.push({ k: line[0] === '+' ? 'add' : 'del', s: clipLine(line.slice(1)) })
  }
  return out
}

/** Cap a file's lines for one response. */
export function capLines(lines: DiffLine[]): { lines: DiffLine[]; truncated: boolean } {
  return lines.length > DIFF_LINES_MAX ? { lines: lines.slice(0, DIFF_LINES_MAX), truncated: true } : { lines, truncated: false }
}
