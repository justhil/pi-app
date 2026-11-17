import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Prefer an unpacked disk copy when an Electron path sits inside `app.asar`. */
export function preferUnpackedAsarPath(filePath: string): string {
  if (!filePath) return filePath
  const candidate = filePath.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked')
  if (candidate !== filePath && existsSync(candidate)) {
    return candidate
  }
  return filePath
}

/** Resolve the built-in Pi coding-agent entry, preferring `app.asar.unpacked` when present. */
export function resolveBuiltinSdkEntry(): string {
  return preferUnpackedAsarPath(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')))
}

/** Expose the active Pi CLI as the worker's script identity for extensions that spawn Pi. */
export async function preparePiCliEntry(sdkEntry: string, argv: string[] = process.argv): Promise<void> {
  try {
    let dir = dirname(preferUnpackedAsarPath(await realpath(preferUnpackedAsarPath(sdkEntry))))
    for (let depth = 0; depth < 8; depth++) {
      let manifest: { name?: string; bin?: string | Record<string, string> } | undefined
      try {
        manifest = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'))
      } catch { /* Try the parent directory. */ }
      if (manifest?.name === '@earendil-works/pi-coding-agent') {
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pi
        if (!bin || isAbsolute(bin)) return
        const root = preferUnpackedAsarPath(await realpath(preferUnpackedAsarPath(dir)))
        const cli = preferUnpackedAsarPath(await realpath(preferUnpackedAsarPath(resolve(root, bin))))
        const path = relative(root, cli)
        if (!path || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) return
        if ((await stat(cli)).isFile()) argv[1] = cli
        return
      }
      const parent = dirname(dir)
      if (parent === dir) return
      dir = parent
    }
  } catch {
    // Do not disrupt sessions when the SDK has no accessible CLI.
  }
}
