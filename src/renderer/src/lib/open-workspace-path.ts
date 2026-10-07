import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeWslWindowsPath, windowsPathToWsl, wslWindowsPathDistro } from '@shared/wsl-path'

/** Decode local Markdown destinations without treating web or executable URLs as files. */
export function localFilePathFromHref(href: string, baseDirectory?: string | null): string | null {
  let raw = href.trim()
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || raw.startsWith('#') || raw.startsWith('?')) return null
  if (raw.startsWith('//') && !wslWindowsPathDistro(raw)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^file:/i.test(raw) && !/^[a-zA-Z]:[/\\]/.test(raw)) return null
  if (baseDirectory && !/^file:/i.test(raw) && !/^[/\\]|^[a-zA-Z]:[/\\]/.test(raw)) {
    const directory = baseDirectory.replace(/\\/g, '/')
    // A UNC share (including a WSL distro) is a filesystem root, not a parent directory.
    const uncRoot = directory.match(/^\/\/[^/]+\/[^/]+(?=\/|$)/)?.[0] ?? ''
    const base = encodeURI(directory.slice(uncRoot.length).replace(/\/+$/, '') + '/').replace(/[?#]/g, encodeURIComponent)
    try {
      const resolved = new URL(raw.replace(/\\/g, '/'), `${base.startsWith('/') ? 'file://' : 'file:///'}${base}`)
      raw = uncRoot ? `file:${encodeURI(uncRoot).replace(/[?#]/g, encodeURIComponent)}${resolved.pathname}${resolved.search}${resolved.hash}` : resolved.href
    } catch {
      return null
    }
  }
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw)
      raw = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${url.pathname}` : url.pathname
      if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1)
    } catch {
      return null
    }
  }
  try {
    const decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0])
    return decoded && !/[\u0000-\u001f\u007f]/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

function normalizeRelPath(input: string, workspaceRoot?: string | null): string | null {
  let raw = input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!raw || raw.split('/').includes('..')) return null

  if (workspaceRoot) {
    let root = workspaceRoot.replace(/\\/g, '/')
    const rootDistro = wslWindowsPathDistro(root)
    const pathDistro = wslWindowsPathDistro(raw)
    if (pathDistro && pathDistro.toLowerCase() !== rootDistro?.toLowerCase()) return null
    if (rootDistro || /^[a-zA-Z]:\//.test(root)) {
      raw = windowsPathToWsl(null, normalizeWslWindowsPath(raw))
      root = windowsPathToWsl(null, normalizeWslWindowsPath(root))
    }
    root = root.replace(/\/$/, '')
    const caseInsensitive = /^[a-zA-Z]:[/\\]/.test(workspaceRoot) || (root.startsWith('//') && !rootDistro)
    const comparedPath = caseInsensitive ? raw.toLowerCase() : raw
    const comparedRoot = caseInsensitive ? root.toLowerCase() : root
    if (comparedPath.startsWith(comparedRoot + '/')) {
      raw = raw.slice(root.length + 1)
    } else if (comparedPath === comparedRoot) {
      return null
    }
  }

  // Absolute path outside workspace cannot be opened in Files panel
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) return null
  return raw
}

/** Open a repo-relative (or workspace-absolute) path in Files panel. */
export function openWorkspaceRelativePath(relPath: string): boolean {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace)
  if (!raw || !store.currentWorkspace) return false
  // Keep the request until the lazily loaded Files panel mounts.
  useUIStore.setState({ workspaceFileToOpen: { workspaceRoot: store.currentWorkspace, rel: raw } })
  store.setActivePanel('files')
  store.revealRightPanel()
  return true
}

/** Open Review panel (git scope by default) and optionally focus a file. */
export function openReviewGitForPath(relPath: string): void {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.setActivePanel('review')
  store.revealRightPanel()
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'git' }))
  window.dispatchEvent(
    new CustomEvent('pi-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}

/** Open Review panel on session/turn file list and focus a path. */
export function openReviewSessionForPath(relPath: string): void {
  const store = useUIStore.getState()
  const raw = normalizeRelPath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.setActivePanel('review')
  store.revealRightPanel()
  window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'session' }))
  window.dispatchEvent(
    new CustomEvent('pi-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}
