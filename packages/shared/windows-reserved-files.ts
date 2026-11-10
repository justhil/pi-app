import { readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

const WINDOWS_RESERVED_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'release',
  '.gradle',
  '.next',
  'target',
])

export function isWindowsReservedDeviceName(fileName: string): boolean {
  const trimmed = fileName.trim().replace(/[. ]+$/, '')
  return WINDOWS_RESERVED_DEVICE_RE.test(trimmed)
}

export function toWindowsLiteralPath(filePath: string, platform: string = process.platform): string {
  const resolved = path.resolve(filePath)
  if (platform !== 'win32') return resolved
  const winPath = resolved.replace(/\//g, '\\')
  if (winPath.startsWith('\\\\?\\')) return winPath
  if (winPath.startsWith('\\\\')) return `\\\\?\\UNC\\${winPath.slice(2)}`
  return `\\\\?\\${winPath}`
}

/**
 * Remove stray Windows reserved device files (such as `nul` / `NUL` created by `> nul` in Bash)
 * that break `git add -A` on Windows with `error: short read while indexing nul`.
 */
export async function removeWindowsReservedDeviceFiles(
  rootDir: string,
  opts?: { maxDepth?: number; forcePlatform?: string },
): Promise<string[]> {
  const platform = opts?.forcePlatform ?? process.platform
  if (platform !== 'win32' || !rootDir) return []
  const maxDepth = opts?.maxDepth ?? 2
  const removed: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1)
        }
        continue
      }
      if (!entry.isFile()) continue
      if (!isWindowsReservedDeviceName(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      const target = process.platform === 'win32' ? toWindowsLiteralPath(fullPath, 'win32') : fullPath
      try {
        await unlink(target)
        removed.push(fullPath)
      } catch {
        /* ignore permission or concurrent removal errors */
      }
    }
  }

  await walk(rootDir, 0)
  return removed
}
