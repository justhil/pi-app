export function isSandboxWorkspacePath(path: string | null | undefined): boolean {
  return !!path && path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

/**
 * 启动时根据 localStorage 恢复的 currentWorkspace 决定首屏会话形态。
 * - 无项目 / 上次为沙箱路径 → 临时「新对话」（可立即输入，首条发送再落盘）
 * - 磁盘项目路径 → 恢复项目并后台 ensureWorker
 */
export function resolveBootWorkspaceState(path: string | null | undefined): {
  workspace: string | null
  ephemeralDraft: boolean
  shouldStartWorker: boolean
} {
  if (!path) return { workspace: null, ephemeralDraft: true, shouldStartWorker: false }
  if (isSandboxWorkspacePath(path)) return { workspace: null, ephemeralDraft: true, shouldStartWorker: false }
  return { workspace: path, ephemeralDraft: false, shouldStartWorker: true }
}
