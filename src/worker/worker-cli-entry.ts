import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Expose the active Pi CLI as the worker's script identity for extensions that spawn Pi. */
export async function preparePiCliEntry(sdkEntry: string, argv: string[] = process.argv): Promise<void> {
  try {
    let dir = dirname(await realpath(sdkEntry))
    for (let depth = 0; depth < 8; depth++) {
      let manifest: { name?: string; bin?: string | Record<string, string> } | undefined
      try {
        manifest = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'))
      } catch { /* Try the parent directory. */ }
      if (manifest?.name === '@earendil-works/pi-coding-agent') {
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pi
        if (!bin || isAbsolute(bin)) return
        const root = await realpath(dir)
        const cli = await realpath(resolve(dir, bin))
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
