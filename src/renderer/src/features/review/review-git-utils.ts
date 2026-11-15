import { unquoteGitPath } from '@shared/git-path'
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

function splitRenamePath(pathPart: string): { path: string; oldPath?: string } {
  const match = pathPart.match(/^("(?:[^"\\]|\\.)*"|.*?) -> ("(?:[^"\\]|\\.)*"|.*)$/)
  if (!match) return { path: unquoteGitPath(pathPart) }
  return { oldPath: unquoteGitPath(match[1]), path: unquoteGitPath(match[2]) }
}

function changeTypeFromCode(code: string): string {
  if (code === 'A' || code === '?') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R' || code === 'C') return 'renamed'
  return 'modified'
}

export function listConflictPaths(status: string): string[] {
  const out: string[] = []
  for (const line of status.split('\n').filter(Boolean)) {
    if (line.length < 4 || line.startsWith('##')) continue
    const xy = line.slice(0, 2)
    if (!['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(xy)) continue
    const { path } = splitRenamePath(line.slice(3).trim())
    if (path) out.push(path)
  }
  return out
}

export function parseGitStatus(status: string): ReviewStatusEntry[] {
  if (!status) return []
  const out: ReviewStatusEntry[] = []
  for (const line of status.split('\n').filter(Boolean)) {
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
  return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
}

export function reviewPathMatches(gitPath: string, touched: string[]): boolean {
  const git = reviewPathKey(gitPath).toLowerCase()
  return touched.some((item) => {
    const path = reviewPathKey(item).toLowerCase()
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

import { extractCodemodeArgField, parseCodemodeCalls } from '@shared/tool-call-detail'

const MUTATE_TOOLS = new Set(['write', 'edit', 'insert'])

function pathFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as { path?: unknown; file_path?: unknown; filePath?: unknown }
  const path = rec.path ?? rec.file_path ?? rec.filePath
  return typeof path === 'string' && path ? path : undefined
}

export function collectTouchedPaths(
  fileChanges: { path: string; runId?: string }[],
  tools: {
    toolName?: string
    runId?: string
    path?: string
    toolDetails?: unknown
    toolDetail?: unknown
    toolArgs?: unknown
    isError?: boolean
  }[],
  turnRunId?: string | null,
  workspaceRoot?: string | null,
): string[] {
  const normRoot = workspaceRoot
    ? workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
    : ''
  const isWindowsRoot = /^[a-z]:/i.test(normRoot)

  const normalizeCandidate = (raw: string): string | null => {
    let p = reviewPathKey(raw.trim())
    if (!p) return null
    const isAbs = /^[a-z]:\//i.test(p) || p.startsWith('/')
    if (normRoot && isAbs) {
      const pCmp = isWindowsRoot ? p.toLowerCase() : p
      const rootCmp = isWindowsRoot ? normRoot.toLowerCase() : normRoot
      if (pCmp === rootCmp) return null
      if (pCmp.startsWith(rootCmp + '/')) {
        p = reviewPathKey(p.slice(normRoot.length + 1))
      } else {
        return null
      }
    }
    return p || null
  }

  const seenLower = new Set<string>()
  const out: string[] = []
  const addPath = (raw: string | undefined): void => {
    if (!raw) return
    const n = normalizeCandidate(raw)
    if (!n) return
    const lower = n.toLowerCase()
    if (seenLower.has(lower)) return
    seenLower.add(lower)
    out.push(n)
  }

  for (const change of fileChanges) {
    if (turnRunId && change.runId && change.runId !== turnRunId) continue
    if (turnRunId && !change.runId) continue
    if (change.path) addPath(change.path)
  }
  for (const tool of tools) {
    if (tool.isError) continue
    const toolName = (tool.toolName || '').toLowerCase()
    if (toolName === 'codemode') {
      if (turnRunId && tool.runId && tool.runId !== turnRunId) continue
      if (turnRunId && !tool.runId) continue
      const code =
        tool.toolArgs &&
        typeof tool.toolArgs === 'object' &&
        typeof (tool.toolArgs as { code?: unknown }).code === 'string'
          ? (tool.toolArgs as { code: string }).code
          : undefined
      for (const call of parseCodemodeCalls(tool.toolDetails, code)) {
        if (call.status === 'error' || call.status === 'cancelled') continue
        if (!MUTATE_TOOLS.has(call.name.toLowerCase())) continue
        const p =
          call.path ??
          extractCodemodeArgField(call.args, 'path') ??
          extractCodemodeArgField(call.args, 'file_path')
        addPath(p)
      }
      continue
    }
    if (!MUTATE_TOOLS.has(toolName)) continue
    if (turnRunId && tool.runId && tool.runId !== turnRunId) continue
    if (turnRunId && !tool.runId) continue
    const path = tool.path || pathFromUnknown(tool.toolDetail) || pathFromUnknown(tool.toolArgs)
    addPath(path)
  }
  return out
}
