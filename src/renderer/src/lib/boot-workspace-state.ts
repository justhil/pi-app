export function isSandboxWorkspacePath(path: string | null | undefined): boolean {
  return !!path && path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

/**
 * Cold-start UI shape from persisted currentWorkspace.
 * - No project / last path was a sandbox → ephemeral "new chat" draft
 * - Disk project → restore project metadata only (Worker starts on first Worker-required action)
 */
export function resolveBootWorkspaceState(path: string | null | undefined): {
  workspace: string | null
  ephemeralDraft: boolean
  /** @deprecated Always false; Worker is created lazily on prompt/bind. */
  shouldStartWorker: boolean
} {
  if (!path) return { workspace: null, ephemeralDraft: true, shouldStartWorker: false }
  if (isSandboxWorkspacePath(path)) return { workspace: null, ephemeralDraft: true, shouldStartWorker: false }
  return { workspace: path, ephemeralDraft: false, shouldStartWorker: false }
}
