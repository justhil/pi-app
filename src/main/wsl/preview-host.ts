import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV } from '@shared/worker-frame'
import { wslPathToWindows } from '@shared/wsl-path'
import { resolveUtilityEntry } from '../utility-entry-path'
import { wslCdFlagSupported, wslWorkerDirWsl } from './worker-host'

function previewBundleHash(source: string): string {
  const hash = createHash('sha256')
  const addFile = (path: string): void => {
    hash.update(path)
    hash.update('\u0000')
    hash.update(readFileSync(path, 'utf8'))
  }
  addFile(source)
  const chunks = join(dirname(source), 'chunks')
  if (existsSync(chunks)) {
    for (const name of readdirSync(chunks).sort()) addFile(join(chunks, name))
  }
  return hash.digest('hex')
}

export function syncPreviewBundleToWsl(distro: string): string | null {
  const source = resolveUtilityEntry('preview-wsl.mjs')
  if (!existsSync(source)) return null
  const dirWsl = wslWorkerDirWsl(distro)
  if (!dirWsl) return null
  const dirUnc = wslPathToWindows(distro, dirWsl)
  mkdirSync(dirUnc, { recursive: true })

  const localHash = previewBundleHash(source)
  const hashFile = join(dirUnc, 'preview-wsl.hash')
  try {
    if (readFileSync(hashFile, 'utf8') === localHash) return `${dirWsl}/preview-wsl.mjs`
  } catch {
    /* first sync */
  }

  writeFileSync(join(dirUnc, 'preview-wsl.mjs'), readFileSync(source, 'utf8'), 'utf8')
  const chunksSrc = join(dirname(source), 'chunks')
  if (existsSync(chunksSrc)) {
    const chunksDest = join(dirUnc, 'chunks')
    mkdirSync(chunksDest, { recursive: true })
    for (const name of readdirSync(chunksSrc)) {
      writeFileSync(join(chunksDest, name), readFileSync(join(chunksSrc, name), 'utf8'), 'utf8')
    }
  }
  writeFileSync(join(dirUnc, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  writeFileSync(hashFile, localHash, 'utf8')
  return `${dirWsl}/preview-wsl.mjs`
}

export function spawnPreviewInWsl(opts: {
  distro: string
  wslCwd: string
  previewWslPath: string
}): ChildProcess {
  const args = ['-d', opts.distro]
  if (wslCdFlagSupported(opts.distro)) {
    args.push('--cd', opts.wslCwd, '--', 'node', opts.previewWslPath)
  } else {
    args.push(
      '--',
      'bash',
      '-lc',
      'cd -- "$1" && exec node "$2"',
      'bash',
      opts.wslCwd,
      opts.previewWslPath,
    )
  }
  const env: Record<string, string> = {
    ...process.env,
    [WORKER_STDIO_ENV]: '1',
    [WORKER_WSL_DISTRO_ENV]: opts.distro,
  }
  const inherited = process.env.WSLENV
  const requiredEnv = [WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV]
  const existing = new Set(inherited?.split(':').map((entry) => entry.split('/')[0]))
  const missing = requiredEnv.filter((name) => !existing.has(name))
  if (missing.length) {
    env.WSLENV = [inherited, ...missing].filter(Boolean).join(':')
  }
  return spawn('wsl.exe', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  })
}
