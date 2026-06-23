import { configStore } from './config-store'

export function isSandboxWorkspacePath(p: string): boolean {
  return p.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

/**
 * 避免 currentProject 落在临时沙箱、而 UI 持久化的是磁盘项目时启动双 Worker。
 * 若上次退出时 currentProject 为沙箱，但 recent 里有磁盘路径，优先用最近使用的磁盘项目。
 */
export function resolveStartupWorkspace(): string | null {
  const cur = configStore.get('currentProject')
  if (!cur) return null
  if (!isSandboxWorkspacePath(cur)) return cur

  const recent = configStore.get('recentProjects') || []
  const disk = recent.find((p) => p && !isSandboxWorkspacePath(p))
  if (disk) {
    configStore.set('currentProject', disk)
    return disk
  }
  return null
}