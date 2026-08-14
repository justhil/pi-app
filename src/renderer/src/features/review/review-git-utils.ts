import { parseGitDiff, type DiffFile } from '@shared/diff-model'

export type ReviewStatusEntry = {
  path: string
  oldPath?: string
  changeType: string
  staged: boolean
  unstaged: boolean
}

export type ReviewFileRow = {
  path: string
  oldPath?: string
  changeType: string
  file?: DiffFile
}

export type ReviewFileGroups = {
  staged: ReviewFileRow[]
  unstaged: ReviewFileRow[]
  cleanTouched: string[]
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
  return raw
}

function splitRenamePath(pathPart: string): { path: string; oldPath?: string } {
  const match = pathPart.match(/^(.*) -> (.*)$/)
  if (!match) return { path: unquoteGitPath(pathPart) }
  return { oldPath: unquoteGitPath(match[1]), path: unquoteGitPath(match[2]) }
}

function changeTypeFromCode(code: string): string {
  if (code === 'A' || code === '?') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R' || code === 'C') return 'renamed'
  return 'modified'
}

export function parseGitStatus(status: string): ReviewStatusEntry[] {
  if (!status) return []
  const out: ReviewStatusEntry[] = []
  // 注意：不能对整串 trim()——porcelain v1 第一行的行首状态空格会被吃掉，
  // 导致第一个未暂存文件（' M path'）的路径残缺（'rc/...' 样式）永远匹配不上焦点路径。
  for (const rawLine of status.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    if (line.startsWith('##')) continue
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const { path, oldPath } = splitRenamePath(line.slice(3).trim())
    if (!path) continue
    const untracked = x === '?' || y === '?'
    const staged = !untracked && x !== ' '
    const unstaged = untracked || y !== ' '
    const typeCode = untracked ? '?' : y !== ' ' ? y : x
    out.push({
      path,
      oldPath,
      changeType: changeTypeFromCode(typeCode),
      staged,
      unstaged,
    })
  }
  return out
}

function findDiffFile(files: DiffFile[], path: string, oldPath?: string): DiffFile | undefined {
  return files.find((file) => file.path === path || file.oldPath === path || (oldPath && file.path === oldPath))
}

export function groupReviewFiles(input: {
  status: string
  unstagedRaw: string
  stagedRaw: string
}): ReviewFileGroups {
  const status = parseGitStatus(input.status)
  const unstagedDiffs = parseGitDiff(input.unstagedRaw)
  const stagedDiffs = parseGitDiff(input.stagedRaw)
  const staged: ReviewFileRow[] = []
  const unstaged: ReviewFileRow[] = []
  const seenStaged = new Set<string>()
  const seenUnstaged = new Set<string>()

  for (const entry of status) {
    if (entry.staged) {
      staged.push({
        path: entry.path,
        oldPath: entry.oldPath,
        changeType: entry.changeType,
        file: findDiffFile(stagedDiffs, entry.path, entry.oldPath),
      })
      seenStaged.add(entry.path)
    }
    if (entry.unstaged) {
      unstaged.push({
        path: entry.path,
        oldPath: entry.oldPath,
        changeType: entry.changeType,
        file: findDiffFile(unstagedDiffs, entry.path, entry.oldPath),
      })
      seenUnstaged.add(entry.path)
    }
  }

  for (const file of stagedDiffs) {
    if (seenStaged.has(file.path)) continue
    staged.push({ path: file.path, oldPath: file.oldPath, changeType: file.changeType, file })
  }
  for (const file of unstagedDiffs) {
    if (seenUnstaged.has(file.path)) continue
    unstaged.push({ path: file.path, oldPath: file.oldPath, changeType: file.changeType, file })
  }

  return { staged, unstaged, cleanTouched: [] }
}

export function reviewPathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function reviewPathMatches(gitPath: string, touched: string[]): boolean {
  const git = reviewPathKey(gitPath)
  return touched.some((item) => {
    const path = reviewPathKey(item)
    return path === git || path.endsWith(`/${git}`) || git.endsWith(`/${path}`)
  })
}

export function filterReviewGroups(groups: ReviewFileGroups, touched: string[]): ReviewFileGroups {
  if (touched.length === 0) return { staged: [], unstaged: [], cleanTouched: [] }
  const staged = groups.staged.filter((row) => reviewPathMatches(row.path, touched))
  const unstaged = groups.unstaged.filter((row) => reviewPathMatches(row.path, touched))
  const visible = new Set(
    [...staged, ...unstaged].flatMap((row) => [row.path, row.oldPath].filter(Boolean) as string[]),
  )
  const cleanTouched = touched.filter((path) => !reviewPathMatches(path, [...visible]))
  return { staged, unstaged, cleanTouched }
}

const MUTATE_TOOLS = new Set(['write', 'edit', 'insert'])

function pathFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('path' in value)) return undefined
  const path = (value as { path?: unknown }).path
  return typeof path === 'string' && path ? path : undefined
}

export function collectTouchedPaths(
  fileChanges: { path: string; runId?: string }[],
  tools: { toolName?: string; runId?: string; path?: string; toolDetail?: unknown; toolArgs?: unknown }[],
  turnRunId?: string | null,
): string[] {
  const out = new Set<string>()
  for (const change of fileChanges) {
    if (turnRunId && change.runId && change.runId !== turnRunId) continue
    if (turnRunId && !change.runId) continue
    if (change.path) out.add(reviewPathKey(change.path))
  }
  for (const tool of tools) {
    if (!MUTATE_TOOLS.has(tool.toolName || '')) continue
    if (turnRunId && tool.runId && tool.runId !== turnRunId) continue
    if (turnRunId && !tool.runId) continue
    const path = tool.path || pathFromUnknown(tool.toolDetail) || pathFromUnknown(tool.toolArgs)
    if (path) out.add(reviewPathKey(path))
  }
  return [...out]
}
