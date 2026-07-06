import { useUIStore } from '@renderer/stores/ui-store'

/** Open a repo-relative path in Files panel (best-effort). */
export function openWorkspaceRelativePath(relPath: string): void {
  const raw = relPath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!raw || raw.includes('..')) return
  const store = useUIStore.getState()
  store.setActivePanel('files')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  window.dispatchEvent(
    new CustomEvent('pi-desktop:open-workspace-file', {
      detail: { rel: raw, name: raw.split('/').pop() || raw },
    }),
  )
}

export function openReviewGitForPath(relPath: string): void {
  const raw = relPath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!raw) return
  const store = useUIStore.getState()
  store.setActivePanel('review')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'git' }))
  window.dispatchEvent(
    new CustomEvent('pi-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}