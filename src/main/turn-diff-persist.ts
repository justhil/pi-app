/**
 * 回合最终净 diff 的进程外持久化（app 私有数据目录，不写会话 JSONL）。
 *
 * 基线仍只在 Worker 内存（大对象）；这里只持久化结算后的 diff 文本（≤256KB/回合），
 * 使重启后会话内由 app 完成的回合仍能展示最终净 diff。每会话文件保留最近
 * MAX_RECORDS_PER_SESSION 条，超出整体重写裁剪。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { TurnDiffEvent } from '@shared/app-events'

export type PersistedTurnDiffRecord = {
  sessionFile: string
  turnId?: string
  runId?: string
  turnOrdinal?: number
  files: TurnDiffEvent['files']
  updatedAt: number
}

const MAX_RECORDS_PER_SESSION = 50

/** 与 renderer session-file-key 相同的归一化（避免主进程跨层 import renderer lib）。 */
function normalizeSessionKey(sessionFile: string): string {
  let key = sessionFile.replace(/\\/g, '/')
  if (key.startsWith('//')) {
    key = `//${key.slice(2).replace(/\/+/g, '/')}`
  } else {
    key = key.replace(/\/+/g, '/')
  }
  if (/^[a-zA-Z]:\//.test(key)) {
    key = key.charAt(0).toUpperCase() + key.slice(1)
  }
  return key
}

function turnDiffDir(): string {
  return join(app.getPath('userData'), 'turn-diffs')
}

function fileForSession(sessionFile: string): string {
  const hash = createHash('sha1').update(normalizeSessionKey(sessionFile)).digest('hex').slice(0, 24)
  return join(turnDiffDir(), `${hash}.jsonl`)
}

function writeRecords(file: string, records: PersistedTurnDiffRecord[]): void {
  mkdirSync(turnDiffDir(), { recursive: true })
  const trimmed = records.slice(-MAX_RECORDS_PER_SESSION)
  writeFileSync(file, `${trimmed.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
}

/** app 转发 turn_diff 事件时调用：追加持久化（失败静默，不影响 UI 链路）。 */
export function persistTurnDiff(event: TurnDiffEvent): void {
  const sessionFile = event.sessionFile
  if (!sessionFile) return
  try {
    const file = fileForSession(sessionFile)
    let records: PersistedTurnDiffRecord[] = []
    if (existsSync(file)) {
      records = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as PersistedTurnDiffRecord]
          } catch {
            return []
          }
        })
    }
    records = records.filter(
      (r) =>
        !(
          r.sessionFile === sessionFile &&
          ((r.turnId && event.turnId && r.turnId === event.turnId) ||
            (r.turnOrdinal != null && event.turnOrdinal != null && r.turnOrdinal === event.turnOrdinal))
        ),
    )
    records.push({
      sessionFile,
      turnId: event.turnId,
      runId: event.runId,
      turnOrdinal: event.turnOrdinal,
      files: event.files,
      updatedAt: event.timestamp,
    })
    writeRecords(file, records)
  } catch (e) {
    console.warn('[turn-diff-persist] write failed:', (e as Error).message)
  }
}

export function loadTurnDiffs(sessionFile: string): PersistedTurnDiffRecord[] {
  try {
    const file = fileForSession(sessionFile)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const r = JSON.parse(line) as PersistedTurnDiffRecord
          return r.sessionFile === sessionFile ? [r] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function removeTurnDiffs(sessionFile: string): void {
  try {
    const file = fileForSession(sessionFile)
    if (existsSync(file)) rmSync(file, { force: true })
  } catch {
    /* ignore */
  }
}
