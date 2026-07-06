import type { DiffFile, DiffHunk, DiffLine } from './diff-model'

export type SplitDiffCell = {
  kind: 'context' | 'add' | 'remove' | 'empty'
  text: string
  oldLine?: number
  newLine?: number
}

export type SplitDiffRow = {
  left: SplitDiffCell
  right: SplitDiffCell
}

function lineToCell(line: DiffLine, side: 'left' | 'right'): SplitDiffCell {
  if (line.type === 'hunk-header') {
    return { kind: 'context', text: line.content }
  }
  if (line.type === 'added') {
    return side === 'right'
      ? { kind: 'add', text: line.content, newLine: line.newLineNumber }
      : { kind: 'empty', text: '' }
  }
  if (line.type === 'removed') {
    return side === 'left'
      ? { kind: 'remove', text: line.content, oldLine: line.oldLineNumber }
      : { kind: 'empty', text: '' }
  }
  return {
    kind: 'context',
    text: line.content,
    oldLine: line.oldLineNumber,
    newLine: line.newLineNumber,
  }
}

function pairHunkLines(hunk: DiffHunk): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  const leftQueue: DiffLine[] = []
  const rightQueue: DiffLine[] = []
  for (const line of hunk.lines) {
    if (line.type === 'removed') leftQueue.push(line)
    else if (line.type === 'added') rightQueue.push(line)
    else {
      while (leftQueue.length || rightQueue.length) {
        const l = leftQueue.shift()
        const r = rightQueue.shift()
        if (l && r) {
          rows.push({ left: lineToCell(l, 'left'), right: lineToCell(r, 'right') })
        } else if (l) {
          rows.push({ left: lineToCell(l, 'left'), right: { kind: 'empty', text: '' } })
        } else if (r) {
          rows.push({ left: { kind: 'empty', text: '' }, right: lineToCell(r, 'right') })
        }
      }
      rows.push({ left: lineToCell(line, 'left'), right: lineToCell(line, 'right') })
    }
  }
  while (leftQueue.length || rightQueue.length) {
    const l = leftQueue.shift()
    const r = rightQueue.shift()
    if (l && r) {
      rows.push({ left: lineToCell(l, 'left'), right: lineToCell(r, 'right') })
    } else if (l) {
      rows.push({ left: lineToCell(l, 'left'), right: { kind: 'empty', text: '' } })
    } else if (r) {
      rows.push({ left: { kind: 'empty', text: '' }, right: lineToCell(r, 'right') })
    }
  }
  return rows
}

export function buildSplitDiffRows(file: DiffFile): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  for (const hunk of file.hunks) {
    rows.push({
      left: { kind: 'context', text: `@@ -${hunk.oldStart} +${hunk.newStart} @@` },
      right: { kind: 'context', text: `@@ -${hunk.oldStart} +${hunk.newStart} @@` },
    })
    rows.push(...pairHunkLines(hunk))
  }
  return rows
}