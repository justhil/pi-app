import { realpathSync } from 'node:fs'
import { uniqueWorkspacePaths, workspacePathsEqual } from '@shared/workspace-path'

/** 侧栏「项目」列表上限：侧栏按需加载会话，提高上限避免 10 个以上目录时被静默淘汰。 */
export const RECENT_PROJECTS_CAP = 200

function safeNativeRealpath(value: string): string | null {
  try {
    return realpathSync.native(value)
  } catch {
    return null
  }
}

/** 比较两个工作区路径是否指向同一目录（先词法比较，必要时回退到 realpath 解析符号链接 / Windows junction）。 */
export function workspaceRealPathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (workspacePathsEqual(a, b)) return true
  if (!a?.trim() || !b?.trim()) return false
  const ra = safeNativeRealpath(a)
  const rb = safeNativeRealpath(b)
  return Boolean(ra && rb && workspacePathsEqual(ra, rb))
}

/**
 * 计算 addRecentProject 之后的新列表。
 * fixedOrder=true：顺序固定，已有项目保持原位，新项目追加到末尾；超出上限时保留头部并覆盖末尾，避免首项丢失；
 * fixedOrder=false（默认）：最近使用优先，项目移到最前；超出上限时丢弃末尾最久未用项。
 */
export function nextRecentProjects(
  recent: string[],
  path: string,
  fixedOrder: boolean,
  cap: number = RECENT_PROJECTS_CAP,
): string[] {
  const safeCap = Math.max(1, Math.floor(cap))
  const deduped = uniqueWorkspacePaths(recent)
  if (!path || !path.trim()) return deduped.slice(0, safeCap)
  if (fixedOrder) {
    if (deduped.some((p) => workspacePathsEqual(p, path))) return deduped.slice(0, safeCap)
    if (deduped.length < safeCap) return [...deduped, path]
    return safeCap <= 1 ? [path] : [...deduped.slice(0, safeCap - 1), path]
  }
  const next = deduped.filter((p) => !workspacePathsEqual(p, path))
  next.unshift(path)
  return next.slice(0, safeCap)
}

/**
 * 从列表中移除目标路径，并在首个被移除项的位置就地补入替代路径（如兄弟 worktree），
 * 保持侧栏原有排序位置不发生跳顶或沉底。
 */
export function replaceRecentProjectInPlace(
  recent: string[],
  removedPaths: string[],
  replacementPath: string,
  match: (a: string, b: string) => boolean = workspacePathsEqual,
): string[] {
  const deduped = uniqueWorkspacePaths(recent)
  const isRemoved = (p: string) => removedPaths.some((rem) => match(p, rem))
  const firstRemovedIdx = deduped.findIndex(isRemoved)
  const remaining = deduped.filter((p) => !isRemoved(p))
  if (!replacementPath || !replacementPath.trim() || remaining.some((p) => match(p, replacementPath))) {
    return remaining.slice(0, RECENT_PROJECTS_CAP)
  }
  const insertIdx = firstRemovedIdx >= 0 ? Math.min(firstRemovedIdx, remaining.length) : remaining.length
  remaining.splice(insertIdx, 0, replacementPath)
  return remaining.slice(0, RECENT_PROJECTS_CAP)
}
