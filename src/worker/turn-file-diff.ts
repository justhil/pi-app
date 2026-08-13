/**
 * 回合文件最终净 diff：Worker 内存基线 → 回合结束文件状态。
 *
 * 原则（与 CONTEXT.md 决策一致）：
 * - 只在 edit/write/insert 等可提取路径的修改工具执行前建立基线（首次修改为准）。
 * - 基线只放内存，进程周期内有效；不写会话 JSONL、不写临时文件。
 * - 回合成功 / 失败 / 中止都会结算；最终内容与基线一致（净零变化）不产出条目。
 * - 二进制、超上限、超出工作区、预算耗尽的文件不缓存，结算时以 skipReason 说明。
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createTwoFilesPatch, diffLines } from 'diff'
import type { AppEvent, TurnDiffFile } from '@shared/app-events'
import {
  TURN_DIFF_SNAPSHOT_DEFAULT_BYTES,
  TURN_DIFF_TEXT_MAX_CHARS,
  TURN_DIFF_TEXT_MAX_LINES,
  normalizeTurnDiffSnapshotBytes,
  turnDiffBudgetBytes,
} from '@shared/turn-diff-config'
import { errorMessage } from '@shared/error-message'

export type TurnDiffEmit = (event: AppEvent) => void

export type TurnDiffCaptureOpts = {
  turnId: string
  runId: string
  cwd: string
  base: Record<string, unknown>
  emit: TurnDiffEmit
}

type Baseline = { path: string; content: string; size: number }

type SkipRecord = { path: string; reason: TurnDiffFile['skipReason'] }

type TurnCaptureState = {
  turnId: string
  runId: string
  /** 本 worker 会话生命周期内的回合序号（从 1 起） */
  turnOrdinal: number
  cwd: string
  base: Record<string, unknown>
  emit: TurnDiffEmit
  budgetUsed: number
  files: Map<string, Baseline>
  skipped: Map<string, SkipRecord>
  /** 本回合仍在进行的捕获数：结算前必须等它们写入 files/skipped */
  pendingOps: number
  pendingWaiters: Array<() => void>
}

export type TurnDiffSkipReason = NonNullable<TurnDiffFile['skipReason']>

let current: TurnCaptureState | null = null
let maxSnapshotBytes = TURN_DIFF_SNAPSHOT_DEFAULT_BYTES

/** 回合序号：每个 turn_start +1；切换会话归零（供降级匹配用） */
let turnOrdinalCounter = 0
let ordinalSessionFile: string | null = null

/** turn_start 时调用：推进本会话的回合序号（无修改工具的回合也要占号，保持与视图回合对齐）。 */
export function markTurnStarted(sessionFile: string | null | undefined): number {
  const key = typeof sessionFile === 'string' && sessionFile ? sessionFile : ordinalSessionFile
  if (key !== ordinalSessionFile) {
    ordinalSessionFile = key
    turnOrdinalCounter = 0
  }
  return ++turnOrdinalCounter
}

export function currentTurnOrdinal(): number {
  return turnOrdinalCounter
}

/** Worker 初始化时注入单文件快照上限（0 = 关闭捕获）。 */
export function configureTurnDiffSnapshotBytes(raw: unknown): void {
  maxSnapshotBytes = normalizeTurnDiffSnapshotBytes(raw)
}

export function turnDiffSnapshotBytes(): number {
  return maxSnapshotBytes
}

export function normalizeFileKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export function pickToolPath(toolName: string, args: unknown): string | null {
  const name = (toolName || '').toLowerCase()
  if (name !== 'edit' && name !== 'write' && name !== 'insert') return null
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  const raw = a.path ?? a.file ?? a.filePath
  if (typeof raw !== 'string' || !raw.trim()) return null
  return raw.trim()
}

/** 前 8KB 出现 NUL 视为二进制（与主流做法一致，文本文件基本不可能含 NUL）。 */
export function isBinaryBuffer(buf: Buffer): boolean {
  const head = buf.subarray(0, 8192)
  return head.includes(0)
}

async function resolveInsideWorkspace(filePath: string, cwd: string): Promise<boolean> {
  try {
    const [rp, rc] = await Promise.all([realpath(filePath), realpath(cwd)])
    const rel = relative(rc, rp)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    // 文件可能尚不存在（write 新建）：按词法路径判断是否落在工作区内
    try {
      const rel = relative(resolve(cwd), resolve(filePath))
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
    } catch {
      return false
    }
  }
}

function ensureCapture(opts: TurnDiffCaptureOpts): TurnCaptureState {
  if (current && current.turnId !== opts.turnId) {
    // 兜底：新回合开始捕获时，上一回合若未结算（turn_end 丢失等异常路径）在此结算
    void finalizeTurnDiff()
  }
  if (current && current.turnId === opts.turnId) return current
  current = {
    turnId: opts.turnId,
    runId: opts.runId,
    turnOrdinal: turnOrdinalCounter,
    cwd: opts.cwd,
    base: opts.base,
    emit: opts.emit,
    budgetUsed: 0,
    files: new Map(),
    skipped: new Map(),
    pendingOps: 0,
    pendingWaiters: [],
  }
  return current
}

function finishCaptureOp(state: TurnCaptureState): void {
  state.pendingOps--
  if (state.pendingOps > 0) return
  const waiters = state.pendingWaiters.splice(0)
  for (const resolve of waiters) resolve()
}

function waitForPendingCaptures(state: TurnCaptureState): Promise<void> {
  if (state.pendingOps === 0) return Promise.resolve()
  return new Promise((resolve) => state.pendingWaiters.push(resolve))
}

/**
 * 修改工具开始执行前调用：为文件建立本回合基线（每回合每文件只捕获一次）。
 * 所有失败路径都是"跳过并记录原因"，绝不抛出打断 Agent 执行。
 */
export async function captureTurnFileBaseline(
  toolName: string,
  args: unknown,
  opts: TurnDiffCaptureOpts,
): Promise<void> {
  if (maxSnapshotBytes <= 0) return
  const path = pickToolPath(toolName, args)
  if (!path) return
  const budget = turnDiffBudgetBytes(maxSnapshotBytes)
  const state = ensureCapture(opts)
  state.pendingOps++
  try {
    const key = normalizeFileKey(path)
    if (state.files.has(key) || state.skipped.has(key)) return

    let size = 0
    let exists = false
    try {
      const st = await stat(path)
      exists = true
      size = st.size
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        state.skipped.set(key, { path, reason: 'unreadable' })
        return
      }
    }

    if (exists && size > maxSnapshotBytes) {
      state.skipped.set(key, { path, reason: 'oversize' })
      return
    }
    if (state.budgetUsed + size > budget) {
      state.skipped.set(key, { path, reason: 'budget' })
      return
    }
    if (!(await resolveInsideWorkspace(path, opts.cwd))) {
      state.skipped.set(key, { path, reason: 'outside_workspace' })
      return
    }

    let content = ''
    if (exists) {
      const buf = await readFile(path)
      if (isBinaryBuffer(buf)) {
        state.skipped.set(key, { path, reason: 'binary' })
        return
      }
      content = buf.toString('utf8')
    }
    state.files.set(key, { path, content, size })
    state.budgetUsed += content.length
  } catch (e) {
    console.warn('[turn-file-diff] capture failed:', errorMessage(e))
    state.skipped.set(normalizeFileKey(path), { path, reason: 'unreadable' })
  } finally {
    finishCaptureOp(state)
  }
}

function truncateDiffText(text: string): { text: string; truncated: boolean } {
  const lines = text.split('\n')
  if (lines.length <= TURN_DIFF_TEXT_MAX_LINES && text.length <= TURN_DIFF_TEXT_MAX_CHARS) {
    return { text, truncated: false }
  }
  let out = lines.slice(0, TURN_DIFF_TEXT_MAX_LINES).join('\n')
  if (out.length > TURN_DIFF_TEXT_MAX_CHARS) {
    out = out.slice(0, TURN_DIFF_TEXT_MAX_CHARS)
    // 截断处可能落在行中间：去掉残行
    const nl = out.lastIndexOf('\n')
    if (nl > 0) out = out.slice(0, nl)
  }
  return { text: `${out}\n… (diff 截断)`, truncated: true }
}

function buildNetDiff(path: string, before: string, after: string): {
  status: TurnDiffFile['status']
  additions: number
  deletions: number
  diffText: string
  truncated: boolean
} {
  const parts = diffLines(before, after)
  let additions = 0
  let deletions = 0
  for (const part of parts) {
    if (part.added) additions += part.count ?? 0
    if (part.removed) deletions += part.count ?? 0
  }
  const patch = createTwoFilesPatch(path, path, before, after, '', '', { context: 3 })
  const { text, truncated } = truncateDiffText(patch)
  const status: TurnDiffFile['status'] = before === '' ? 'added' : after === '' ? 'deleted' : 'modified'
  return { status, additions, deletions, diffText: text, truncated }
}

async function readFinalContent(path: string): Promise<{ content: string; error?: boolean }> {
  try {
    const buf = await readFile(path)
    if (isBinaryBuffer(buf)) return { content: buf.toString('utf8'), error: false }
    return { content: buf.toString('utf8') }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { content: '' }
    return { content: '', error: true }
  }
}

/**
 * 回合结束结算：读每个已捕获文件的最终内容，生成净 diff 并发出 turn_diff 事件。
 * 幂等：结算启动时同步清空状态，重复调用（turn_end / agent_settled 双保险）为 no-op。
 */
export async function finalizeTurnDiff(): Promise<void> {
  const state = current
  current = null
  if (!state) return
  // 等待本回合已开始的捕获全部写入（它们在途时只持 state 引用，不碰 current）
  await waitForPendingCaptures(state)
  if (state.files.size === 0 && state.skipped.size === 0) return

  const files: TurnDiffFile[] = []
  for (const [, baseline] of state.files) {
    const path = baseline.path
    const finalRes = await readFinalContent(path)
    if (finalRes.error) {
      files.push({
        path,
        status: baseline.content === '' ? 'added' : 'modified',
        additions: 0,
        deletions: 0,
        skipReason: 'unreadable',
        sizeBefore: baseline.size,
      })
      continue
    }
    const after = finalRes.content
    if (after === baseline.content) continue // 净零变化：不计入汇总
    const isBinaryFinal = isBinaryBuffer(Buffer.from(after, 'utf8'))
    if (isBinaryFinal) {
      files.push({
        path,
        status: baseline.content === '' ? 'added' : after === '' ? 'deleted' : 'modified',
        additions: 0,
        deletions: 0,
        binary: true,
        sizeBefore: baseline.size,
        sizeAfter: Buffer.byteLength(after, 'utf8'),
      })
      continue
    }
    const diff = buildNetDiff(path, baseline.content, after)
    files.push({
      path,
      status: diff.status,
      additions: diff.additions,
      deletions: diff.deletions,
      diffText: diff.diffText,
      truncated: diff.truncated,
    })
  }

  for (const [, skipped] of state.skipped) {
    files.push({
      path: skipped.path,
      status: 'modified',
      additions: 0,
      deletions: 0,
      skipReason: skipped.reason,
    })
  }

  if (files.length === 0) return
  state.emit({
    ...state.base,
    type: 'turn_diff',
    turnId: state.turnId,
    runId: state.runId,
    turnOrdinal: state.turnOrdinal,
    files,
  } as AppEvent)
}

/** 测试/重启钩子：丢弃未结算状态。 */
export function resetTurnDiffState(): void {
  current = null
  turnOrdinalCounter = 0
  ordinalSessionFile = null
}
