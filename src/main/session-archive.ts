import { configStore } from './config-store'
import { normalizeSessionFileKey } from './session-display-names'

/** 归档元数据：configStore `archivedSessions`（键=规范化路径，值=归档时间戳）。不改动会话文件。 */
export function getArchivedAt(sessionFile: string): number | undefined {
  return configStore.get('archivedSessions')[normalizeSessionFileKey(sessionFile)]
}

export function isSessionArchived(sessionFile: string): boolean {
  return getArchivedAt(sessionFile) != null
}

export function archiveSession(sessionFile: string): void {
  const map = { ...configStore.get('archivedSessions') }
  map[normalizeSessionFileKey(sessionFile)] = Date.now()
  configStore.set('archivedSessions', map)
}

export function restoreSession(sessionFile: string): void {
  const map = { ...configStore.get('archivedSessions') }
  delete map[normalizeSessionFileKey(sessionFile)]
  configStore.set('archivedSessions', map)
}

/** 批量取消归档：一次性移除多个会话的归档标记，返回实际恢复的数量。 */
export function restoreSessions(paths: string[]): number {
  const map = { ...configStore.get('archivedSessions') }
  let count = 0
  for (const p of paths) {
    if (p && map[normalizeSessionFileKey(p)] != null) {
      delete map[normalizeSessionFileKey(p)]
      count++
    }
  }
  if (count > 0) configStore.set('archivedSessions', map)
  return count
}

/** 删除会话时同步清理归档标记，避免孤儿键。 */
export function clearSessionArchive(sessionFile: string): void {
  const map = { ...configStore.get('archivedSessions') }
  delete map[normalizeSessionFileKey(sessionFile)]
  configStore.set('archivedSessions', map)
}

/**
 * 批量归档：按“早于某时间”或“仅保留最近 N 个”规则归档未归档会话。
 * 返回实际归档数量。metadata-only，不改动会话文件。
 */
export function archiveSessionsByRule(input: {
  rows: Array<{ path: string; modified?: Date | null }>
  /** 归档 modified 早于该毫秒时间戳的会话 */
  before?: number
  /** 仅保留 modified 最新的前 N 个，其余归档 */
  keepRecent?: number
}): number {
  const { before, keepRecent } = input
  const hasBefore = before != null && before > 0
  // keepRecent=0 表示“一个都不保留”→ 全部归档
  const hasKeep = keepRecent != null && keepRecent >= 0
  if (!hasBefore && !hasKeep) return 0

  let candidates = input.rows.filter((r) => !isSessionArchived(r.path))
  if (hasBefore) {
    candidates = candidates.filter((r) => {
      const m = r.modified?.getTime?.() ?? 0
      return m > 0 && m < before!
    })
  } else if (hasKeep) {
    candidates = candidates
      .filter((r) => (r.modified?.getTime?.() ?? 0) > 0)
      .sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0))
      .slice(keepRecent!)
  }

  if (candidates.length === 0) return 0
  const map = { ...configStore.get('archivedSessions') }
  const now = Date.now()
  for (const r of candidates) map[normalizeSessionFileKey(r.path)] = now
  configStore.set('archivedSessions', map)
  return candidates.length
}

/**
 * 批量取消归档：仅保留最近归档的 N 个会话（keepRecent=0 → 全部恢复），其余恢复。
 * 返回实际恢复的数量。metadata-only。
 */
export function restoreSessionsByRule(input: { paths: string[]; keepRecent?: number }): number {
  const keepRecent = input.keepRecent ?? 0
  const archived = input.paths
    .map((p) => ({ path: p, at: getArchivedAt(p) }))
    .filter((x): x is { path: string; at: number } => x.at != null)
    .sort((a, b) => b.at - a.at)
  const keepSet = new Set(
    (keepRecent > 0 ? archived.slice(0, keepRecent) : []).map((k) => normalizeSessionFileKey(k.path)),
  )
  const toRestore = archived.filter((x) => !keepSet.has(normalizeSessionFileKey(x.path)))
  if (toRestore.length === 0) return 0
  const map = { ...configStore.get('archivedSessions') }
  for (const x of toRestore) {
    delete map[normalizeSessionFileKey(x.path)]
  }
  configStore.set('archivedSessions', map)
  return toRestore.length
}
