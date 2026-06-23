export function isSandboxWorkspacePath(path: string | null | undefined): boolean {
  return !!path && path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

export function resolveBootWorkspaceState(path: string | null | undefined): {
  workspace: string | null
  ephemeralDraft: boolean
  shouldStartWorker: boolean
} {
  if (!path) return { workspace: null, ephemeralDraft: false, shouldStartWorker: false }
  if (isSandboxWorkspacePath(path)) return { workspace: null, ephemeralDraft: true, shouldStartWorker: false }
  return { workspace: path, ephemeralDraft: false, shouldStartWorker: true }
}
