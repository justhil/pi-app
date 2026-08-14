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

function unquoteGitPath(value: string): string {
  const raw = value.trim()
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
  }
  return raw.replace(/^[ab]\//, '')
}

function stripDiffPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = unquoteGitPath(value)
  if (trimmed === '/dev/null') return undefined
  return trimmed.replace(/^[ab]\//, '')
}

function parseDiffHeader(headText: string): {
  path: string
  oldPath?: string
  status: DiffFileStatus
  binary: boolean
} {
  const plus = headText.match(/^\+\+\+\s+(.+)$/m)?.[1]
  const minus = headText.match(/^---\s+(.+)$/m)?.[1]
  const gitLine = headText.match(/^diff --git\s+(.+)$/m)?.[1] || ''
  const gitQuoted = gitLine.match(/^("(?:\\.|[^"\\])*")\s+("(?:\\.|[^"\\])*")$/)
  const gitPlain = gitQuoted ? null : gitLine.match(/^(\S+)\s+(\S+)$/)
  const git = gitQuoted || gitPlain
  const renameTo = headText.match(/^rename to\s+(.+)$/m)?.[1]
  const renameFrom = headText.match(/^rename from\s+(.+)$/m)?.[1]
  const path =
    stripDiffPath(plus) ||
    stripDiffPath(renameTo) ||
    stripDiffPath(git?.[2]) ||
    'unknown'
  const oldPath =
    stripDiffPath(minus) ||
    stripDiffPath(renameFrom) ||
    stripDiffPath(git?.[1])
  const binary = /^Binary files /m.test(headText) || /^GIT binary patch/m.test(headText)
  const isNew = /--- \/dev\/null/.test(headText) || /^new file mode/m.test(headText)
  const isDel = /\+\+\+ \/dev\/null/.test(headText) || /^deleted file mode/m.test(headText)
  const renamed = Boolean(renameTo || /^similarity index/m.test(headText) && oldPath && oldPath !== path)
  const status: DiffFileStatus = isNew
    ? 'added'
    : isDel
      ? 'deleted'
      : renamed
        ? 'renamed'
        : 'modified'
  return { path, oldPath: oldPath && oldPath !== path ? oldPath : undefined, status, binary }
}

/** 解析 git diff 原始输出为结构化 DiffFile[]，每个 hunk 带 patch（git apply --cached）*/
export function parseGitDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return []
  const files: DiffFile[] = []
  const chunks = raw.split(/^(?=diff --git )/m).filter((c) => c.trim())
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const headerIdx = lines.findIndex((l) => l.startsWith('@@'))
    const headerLines = headerIdx >= 0 ? lines.slice(0, headerIdx) : lines
    const headText = headerLines.join('\n')
    const meta = parseDiffHeader(headText)
    const hunks: DiffHunk[] = []
    let i = headerIdx >= 0 ? headerIdx : lines.length
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
    const additions = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'added').length, 0)
    const deletions = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'removed').length, 0)
    const file: DiffFile = {
      path: meta.path,
      oldPath: meta.oldPath,
      status: meta.status,
      changeType: meta.status === 'copied' ? 'renamed' : meta.status === 'added' || meta.status === 'deleted' || meta.status === 'renamed' ? meta.status : 'modified',
      additions,
      deletions,
      hunks,
      binary: meta.binary,
      large: false,
      generated: isGeneratedFile(meta.path),
    }
    file.large = isLargeDiff(file)
    files.push(file)
  }
  return files
}
