// DiffModel - Unified diff representation for Review panel

export type DiffLineType = 'added' | 'removed' | 'context' | 'hunk-header'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
  lines: DiffLine[]
  /** 可应用 patch（git apply --cached 用）*/
  patch?: string
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

export interface DiffFile {
  path: string
  oldPath?: string
  status: DiffFileStatus
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  hunks: DiffHunk[]
  binary: boolean
  large: boolean
  generated: boolean
}

export interface DiffResult {
  files: DiffFile[]
  totalAdditions: number
  totalDeletions: number
  baseCommit?: string
  headCommit?: string
}

export interface DiffSummary {
  fileCount: number
  totalAdditions: number
  totalDeletions: number
  files: { path: string; status: DiffFileStatus; additions: number; deletions: number }[]
}

export function diffResultToSummary(diff: DiffResult): DiffSummary {
  return {
    fileCount: diff.files.length,
    totalAdditions: diff.totalAdditions,
    totalDeletions: diff.totalDeletions,
    files: diff.files.map(f => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  }
}

// Heuristics for folding
export function isGeneratedFile(path: string): boolean {
  return /\.(lock|min\.js|min\.css|bundle\.js|generated\.ts)$/i.test(path)
    || /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i.test(path)
}

export function isLargeDiff(file: DiffFile, threshold = 500): boolean {
  return file.additions + file.deletions > threshold
}

/** 解析 git diff 原始输出为结构化 DiffFile[]，每个 hunk 带 patch（git apply --cached）*/
export function parseGitDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return []
  const files: DiffFile[] = []
  const chunks = raw.split(/^(?=diff --git )/m).filter((c) => c.trim())
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const headerIdx = lines.findIndex((l) => l.startsWith('@@'))
    if (headerIdx < 0) continue
    const headerLines = lines.slice(0, headerIdx)
    const headText = headerLines.join('\n')
    const pathMatch = headText.match(/\+\+\+ b\/(.+)$/m) || headText.match(/diff --git a\/(.+?) b\//)
    const oldPathMatch = headText.match(/--- a\/(.+)$/m)
    const path = pathMatch ? pathMatch[1].trim() : 'unknown'
    const isNew = /--- \/dev\/null/.test(headText)
    const isDel = /\+\+\+ \/dev\/null/.test(headText)
    const status: DiffFileStatus = isNew ? 'added' : isDel ? 'deleted' : 'modified'
    const hunks: DiffHunk[] = []
    let i = headerIdx
    while (i < lines.length) {
      const hl = lines[i]
      const hm = hl.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (!hm) { i++; continue }
      const oldStart = parseInt(hm[1], 10)
      const newStart = parseInt(hm[2], 10)
      const hunkLines: DiffLine[] = [{ type: 'hunk-header', content: hl }]
      i++
      let oldLn = oldStart
      let newLn = newStart
      while (i < lines.length && lines[i] && !lines[i].startsWith('@@')) {
        const l = lines[i]
        if (l.startsWith('diff --git ')) break
        if (l.startsWith('+')) {
          hunkLines.push({ type: 'added', content: l.slice(1), newLineNumber: newLn++ })
        } else if (l.startsWith('-')) {
          hunkLines.push({ type: 'removed', content: l.slice(1), oldLineNumber: oldLn++ })
        } else if (l.startsWith('\\')) {
          // no-newline marker
        } else {
          const body = l.startsWith(' ') ? l.slice(1) : l
          hunkLines.push({ type: 'context', content: body, oldLineNumber: oldLn++, newLineNumber: newLn++ })
        }
        i++
      }
      const patch = headText + '\n' + hl + '\n' + hunkLines.slice(1).map((d) => {
        if (d.type === 'added') return '+' + d.content
        if (d.type === 'removed') return '-' + d.content
        return ' ' + d.content
      }).join('\n') + '\n'
      hunks.push({ oldStart, oldEnd: oldLn - 1, newStart, newEnd: newLn - 1, lines: hunkLines, patch })
    }
    if (!hunks.length) continue
    const additions = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'added').length, 0)
    const deletions = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'removed').length, 0)
    const file: DiffFile = {
      path,
      oldPath: oldPathMatch ? oldPathMatch[1].trim() : undefined,
      status,
      changeType: status === 'added' ? 'added' : status === 'deleted' ? 'deleted' : 'modified',
      additions, deletions, hunks,
      binary: false, large: false, generated: isGeneratedFile(path),
    }
    file.large = isLargeDiff(file)
    files.push(file)
  }
  return files
}
