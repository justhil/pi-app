import { useUIStore } from '@renderer/stores/ui-store'

function normalizeRelPath(input: string, workspaceRoot?: string | null): string | null {
  let raw = input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!raw || raw.includes('..')) return null

  if (workspaceRoot) {
    const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
    if (raw.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      raw = raw.slice(root.length + 1)
    } else if (raw.toLowerCase() === root.toLowerCase()) {
      return null
    }
  }

  // Absolute path outside workspace cannot be opened in Files panel
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) return null
  return raw
}

/** Open a repo-relative (or workspace-absolute) path in Files panel. */
export function openWorkspaceRelativePath(relPath: string): void {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace)
  if (!raw) return
  store.requestPanelOpen({
    panel: 'files',
    path: raw,
    name: raw.split('/').pop() || raw,
  })
  // 双重投递兜底：面板已挂载时事件立即消费；未挂载时由 store 意图在挂载后消费（幂等）
  window.dispatchEvent(
    new CustomEvent('pi-desktop:open-workspace-file', {
      detail: { rel: raw, name: raw.split('/').pop() || raw },
    }),
  )
}

/** Open Review panel (git scope by default) and optionally focus a file. */
export function openReviewGitForPath(relPath: string): void {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.requestPanelOpen({ panel: 'review', scope: 'git', path: raw })
  // 双重投递兜底（与 Files 同理）
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'git' }))
  window.dispatchEvent(
    new CustomEvent('pi-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}

/** Open Review panel on git scope without a file target. */
export function requestReviewPanel(): void {
  useUIStore.getState().requestPanelOpen({ panel: 'review', scope: 'git' })
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'git' }))
}

/** Open Review panel on session/turn file list and focus a path. */
export function openReviewSessionForPath(relPath: string): void {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.requestPanelOpen({ panel: 'review', scope: 'session', path: raw })
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'session' }))
  window.dispatchEvent(
    new CustomEvent('pi-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}
