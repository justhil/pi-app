import { workspacePathsEqual } from '@shared/workspace-path'

/** 项目 MRU 列表上限（与 config-store 历史行为一致）。 */
export const RECENT_PROJECTS_CAP = 10

/**
 * A temporary chat's folder (`…/sandbox-workspaces/<id>`, on the host or inside WSL). Matched by
 * name like the sidebar does: config-store cannot import sandbox-workspaces without a cycle.
 */
export function isSandboxProjectPath(path: string): boolean {
  return /[\\/]sandbox-workspaces[\\/][^\\/]+[\\/]?$/.test(path)
}

/**
 * 计算 addRecentProject 之后的新列表。
 * fixedOrder=true：顺序固定，已有项目保持不变，新项目追加到末尾；
 * fixedOrder=false（默认）：最近使用优先，项目移到最前。
 * 超出上限时先丢弃最旧的临时对话目录：它们不在侧栏「项目」里显示，却曾占满名额，
 * 把排在最旧位置的真实项目从侧栏里挤掉。
 */
export function nextRecentProjects(recent: string[], path: string, fixedOrder: boolean): string[] {
  let next: string[]
  if (fixedOrder) {
    if (recent.some((p) => workspacePathsEqual(p, path))) return recent
    next = [...recent, path]
  } else {
    next = [path, ...recent.filter((p) => !workspacePathsEqual(p, path))]
  }
  // Oldest first: the head of a fixed-order list, the tail of an MRU list. The new path stays.
  const oldestFirst = fixedOrder ? next : [...next].reverse()
  const candidates = [
    ...oldestFirst.filter((p) => p !== path && isSandboxProjectPath(p)),
    ...oldestFirst.filter((p) => p !== path && !isSandboxProjectPath(p)),
  ]
  const drop = new Set(candidates.slice(0, Math.max(0, next.length - RECENT_PROJECTS_CAP)))
  return next.filter((p) => !drop.has(p))
}
