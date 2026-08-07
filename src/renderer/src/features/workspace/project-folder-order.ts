/** 侧栏项目文件夹的显示顺序。 */
export function projectFolderOrder(
  recentProjects: string[],
  currentWorkspace: string | null | undefined,
  fixedOrder: boolean,
): string[] {
  const out: string[] = []
  const add = (p: string) => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (fixedOrder) {
    // 固定顺序：完全按存储顺序展示，当前项目不置顶，仅保证在列表中
    for (const p of recentProjects) add(p)
    if (currentWorkspace) add(currentWorkspace)
  } else {
    // 最近使用（默认）：当前项目置顶，其余按 MRU
    if (currentWorkspace) add(currentWorkspace)
    for (const p of recentProjects) add(p)
  }
  return out
}
