import { normalizeSessionFilePath } from './session-file-path'

/** Comparison key only; retain the original path for disk access and display. */
export function workspacePathKey(value: string | null | undefined): string {
  const path = normalizeSessionFilePath(value).replace(/\/$/, '')
  const wsl = path.match(/^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)(.*)$/i)
  if (wsl) return `//wsl.localhost/${wsl[1].toLowerCase()}${wsl[2]}`
  return /^[a-z]:/i.test(path) || path.startsWith('//') ? path.toLowerCase() : path || (value === '/' ? '/' : '')
}

export function workspacePathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = workspacePathKey(a)
  return !!key && key === workspacePathKey(b)
}

export function uniqueWorkspacePaths(paths: string[]): string[] {
  return [...new Map(paths.filter(Boolean).map((path) => [workspacePathKey(path), path])).values()]
}

export function projectDisplayNameKey(path: string | null | undefined, isRepositoryGroup = false): string {
  const key = workspacePathKey(path)
  if (!key) return ''
  return isRepositoryGroup ? `repo:${key}` : key
}

export function resolveProjectDisplayName(
  names: Record<string, string> | null | undefined,
  path: string | null | undefined,
  fallbackName: string,
  options?: { isRepositoryGroup?: boolean; grouped?: boolean },
): string {
  if (!names || !path) return fallbackName
  const key = workspacePathKey(path)
  if (!key) return fallbackName
  if (options?.isRepositoryGroup) {
    return names[`repo:${key}`]?.trim() || fallbackName
  }
  const direct = names[key]?.trim()
  if (direct) return direct
  if (!options?.grouped) {
    const repoName = names[`repo:${key}`]?.trim()
    if (repoName) return repoName
  }
  return fallbackName
}
