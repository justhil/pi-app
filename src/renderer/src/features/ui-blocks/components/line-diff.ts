/** Myers diff over sequences plus the row model the diff block renders (unit-tested). */

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; a: number; b: number }

const MAX_COMBINED = 6000

/** Shortest edit script (Myers O((N+M)·D)); oversized inputs degrade to delete-all + insert-all. */
export function diffSequences(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n + m > MAX_COMBINED) {
    return [
      ...a.map((_, index) => ({ type: 'delete' as const, a: index, b: -1 })),
      ...b.map((_, index) => ({ type: 'insert' as const, a: -1, b: index })),
    ]
  }
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  // Backtrack through the saved frontiers.
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const frontier = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && frontier[offset + k - 1] < frontier[offset + k + 1]) ? k + 1 : k - 1
    const prevX = frontier[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      ops.push({ type: 'equal', a: x, b: y })
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: 'insert', a: -1, b: prevY })
      else ops.push({ type: 'delete', a: prevX, b: -1 })
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

export type Segment = { text: string; changed: boolean }

const TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g

/** Word-level highlight for a changed line pair; CJK splits per character. */
export function diffWords(before: string, after: string): { before: Segment[]; after: Segment[] } {
  const a = before.match(TOKEN_RE) ?? []
  const b = after.match(TOKEN_RE) ?? []
  const ops = diffSequences(a, b)
  const left: Segment[] = []
  const right: Segment[] = []
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1]
    if (last && last.changed === changed) last.text += text
    else list.push({ text, changed })
  }
  for (const op of ops) {
    if (op.type === 'equal') {
      push(left, a[op.a], false)
      push(right, b[op.b], false)
    } else if (op.type === 'delete') push(left, a[op.a], true)
    else push(right, b[op.b], true)
  }
  return { before: left, after: right }
}

export type DiffRow =
  | { kind: 'context'; oldNo: number; newNo: number; text: string }
  | { kind: 'del'; oldNo: number; text: string; segments?: Segment[] }
  | { kind: 'add'; newNo: number; text: string; segments?: Segment[] }
  | { kind: 'fold'; id: string; count: number; rows: DiffRow[] }

const CONTEXT = 3

/** Unified rows with paired word highlights and long unchanged runs folded. */
export function buildDiffRows(beforeText: string, afterText: string): { rows: DiffRow[]; added: number; removed: number } {
  const before = beforeText.replace(/\r\n/g, '\n').split('\n')
  const after = afterText.replace(/\r\n/g, '\n').split('\n')
  const ops = diffSequences(before, after)
  const flat: Array<Exclude<DiffRow, { kind: 'fold' }>> = []
  let added = 0
  let removed = 0
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op.type === 'equal') {
      flat.push({ kind: 'context', oldNo: op.a + 1, newNo: op.b + 1, text: before[op.a] })
      index += 1
      continue
    }
    const dels: DiffOp[] = []
    const adds: DiffOp[] = []
    while (index < ops.length && ops[index].type !== 'equal') {
      if (ops[index].type === 'delete') dels.push(ops[index])
      else adds.push(ops[index])
      index += 1
    }
    removed += dels.length
    added += adds.length
    const pairs = Math.min(dels.length, adds.length)
    const words = Array.from({ length: pairs }, (_, pair) => diffWords(before[dels[pair].a], after[adds[pair].b]))
    dels.forEach((del, at) =>
      flat.push({ kind: 'del', oldNo: del.a + 1, text: before[del.a], segments: words[at]?.before }),
    )
    adds.forEach((add, at) =>
      flat.push({ kind: 'add', newNo: add.b + 1, text: after[add.b], segments: words[at]?.after }),
    )
  }
  // Fold unchanged runs longer than 2×CONTEXT (keep CONTEXT lines next to each change).
  const rows: DiffRow[] = []
  let cursor = 0
  while (cursor < flat.length) {
    if (flat[cursor].kind !== 'context') {
      rows.push(flat[cursor])
      cursor += 1
      continue
    }
    let end = cursor
    while (end < flat.length && flat[end].kind === 'context') end += 1
    const run = flat.slice(cursor, end)
    const leading = cursor === 0 ? 0 : CONTEXT
    const trailing = end === flat.length ? 0 : CONTEXT
    if (run.length > leading + trailing + 2) {
      rows.push(...run.slice(0, leading))
      const hidden = run.slice(leading, run.length - trailing)
      rows.push({ kind: 'fold', id: `fold-${cursor}`, count: hidden.length, rows: hidden })
      rows.push(...run.slice(run.length - trailing))
    } else {
      rows.push(...run)
    }
    cursor = end
  }
  return { rows, added, removed }
}
