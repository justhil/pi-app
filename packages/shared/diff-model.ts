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
