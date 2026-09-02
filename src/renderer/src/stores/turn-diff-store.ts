/**
 * 回合文件最终净 diff 的进程内缓存（不持久化，不写入会话 JSONL）。
 *
 * 键：sessionFile + turnId（优先）/ runId（回退）。
 * 容量：最多保留 MAX_RECORDS 条（按更新时间淘汰最旧），防止长时间会话无限增长。
 */
import { create } from 'zustand'
import type { TurnDiffFile } from '@shared/app-events'
import { sessionFilesEqual, normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { ipcClient } from '@renderer/lib/ipc-client'

export type TurnDiffRecord = {
  sessionFile: string
  turnId?: string
  runId?: string
  /** worker 会话生命周期内的回合序号（降级匹配用） */
  turnOrdinal?: number
  files: TurnDiffFile[]
  updatedAt: number
}

const MAX_RECORDS = 60

type TurnDiffState = {
  records: TurnDiffRecord[]
  addRecord: (record: TurnDiffRecord) => void
  clearAll: () => void
}

export const useTurnDiffStore = create<TurnDiffState>((set) => ({
  records: [],
  addRecord: (record) =>
    set((s) => {
      const next = s.records.filter(
        (r) =>
          !(
            sessionFilesEqual(r.sessionFile, record.sessionFile) &&
            (((r.turnId && record.turnId && r.turnId === record.turnId) ||
              (!r.turnId && !record.turnId && r.runId === record.runId)) ||
              (r.turnOrdinal != null && record.turnOrdinal != null && r.turnOrdinal === record.turnOrdinal))
          ),
      )
      next.push(record)
      while (next.length > MAX_RECORDS) next.shift()
      return { records: next }
    }),
  clearAll: () => set({ records: [] }),
}))

const loadedSessions = new Set<string>()

/** 会话打开时调用：从 app 私有持久化（turn-diffs 目录）恢复该会话的历史净 diff。 */
export async function loadTurnDiffsForSession(sessionFile: string): Promise<void> {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key || loadedSessions.has(key)) return
  loadedSessions.add(key)
  try {
    const res = (await ipcClient.invoke('session.getTurnDiffs', {
      sessionFile,
      workspaceId: undefined,
    })) as { records?: TurnDiffRecord[] } | null
    const records = Array.isArray(res?.records) ? res.records : []
    for (const record of records) {
      useTurnDiffStore.getState().addRecord(record)
    }
  } catch {
    /* 持久化不存在/失败：静默降级到逐工具 diff */
  }
}

/**
 * 按回合块查找 diff 记录。匹配链（从精确到降级）：
 * 1. turnId 精确匹配（live 条目）
 * 2. runId 回退（无 turnId 的 live 条目）
 * 3. 回合序号匹配（磁盘投影条目丢失 id 时）
 * 4. fallbackNewest：取该会话最新记录（只用于视图最后一个已完成回合）
 */
export function findTurnDiffRecord(
  sessionFile: string | null | undefined,
  turnIds: string[],
  runIds: string[],
  opts?: { turnOrdinal?: number; fallbackNewest?: boolean },
): TurnDiffRecord | null {
  if (!sessionFile) return null
  const records = useTurnDiffStore.getState().records
  const idSet = new Set(turnIds.length > 0 ? turnIds : runIds)
  const bySession = (r: TurnDiffRecord) => sessionFilesEqual(r.sessionFile, sessionFile)
  if (idSet.size > 0) {
    const hasTurnIds = turnIds.length > 0
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i]
      if (!bySession(r)) continue
      if (hasTurnIds) {
        if (r.turnId && idSet.has(r.turnId)) return r
      } else if (r.runId && idSet.has(r.runId)) {
        return r
      }
    }
  }
  if (opts?.turnOrdinal != null) {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i]
      if (bySession(r) && r.turnOrdinal === opts.turnOrdinal) return r
    }
  }
  if (opts?.fallbackNewest) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (bySession(records[i])) return records[i]
    }
  }
  return null
}
