import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { wslPathToWindows } from '@shared/wsl-path'
import { isSshDistro } from '../ssh/ssh-exec'
import { resolveUtilityEntry } from '../utility-entry-path'
import { runWslDistroAsync, wslHomeDir } from './wsl-exec'
import { getCachedWslEnv } from './wsl-env'

const pending = new Map<string, Promise<string | null>>()
const sshHashCache = new Map<string, string>()

const SSH_BUNDLE_WRITE_JS = [
  'const fs = require("fs"), path = require("path");',
  'const payload = JSON.parse(fs.readFileSync(0, "utf8"));',
  'fs.mkdirSync(payload.dir, { recursive: true });',
  'if (payload.chunks && payload.chunks.length) fs.mkdirSync(path.posix.join(payload.dir, "chunks"), { recursive: true });',
  'fs.writeFileSync(path.posix.join(payload.dir, payload.entry), Buffer.from(payload.mainB64, "base64"));',
  'for (const c of payload.chunks || []) {',
  '  fs.writeFileSync(path.posix.join(payload.dir, "chunks", c.name), Buffer.from(c.b64, "base64"));',
  '}',
  'fs.writeFileSync(path.posix.join(payload.dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");',
  'fs.writeFileSync(path.posix.join(payload.dir, payload.markerFile), payload.marker, "utf8");',
].join(' ')

export function syncWslBundle(distro: string, entry: 'worker.mjs' | 'preview-wsl.mjs'): Promise<string | null> {
  // Both entries write shared chunks; serialize copies before starting either process.
  const previous = pending.get(distro) ?? Promise.resolve(null)
  const job = previous.catch(() => null).then(() => copyBundle(distro, entry))
  pending.set(distro, job)
  void job.finally(() => {
    if (pending.get(distro) === job) pending.delete(distro)
  }).catch(() => {})
  return job
}

async function copyBundle(distro: string, entry: 'worker.mjs' | 'preview-wsl.mjs'): Promise<string | null> {
  const source = resolveUtilityEntry(entry)
  try {
    await access(source)
  } catch {
    return null
  }
  const home = await wslHomeDir(distro)
  if (!home) return null
  const dir = `${home}/.pi-desktop`
  const chunksSource = join(dirname(source), 'chunks')
  const chunks = (await readdir(chunksSource).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })).sort()
  const files = [source, ...chunks.map((name) => join(chunksSource, name))]
  const contents = await Promise.all(files.map((file) => readFile(file)))
  const hash = createHash('sha256')
  files.forEach((file, index) => { hash.update(file); hash.update('\u0000'); hash.update(contents[index]) })
  const marker = hash.digest('hex')
  const markerFile = entry.replace(/\.mjs$/, '.hash')

  if (isSshDistro(distro)) {
    const cacheKey = `${distro}:${entry}`
    if (sshHashCache.get(cacheKey) === marker) return `${dir}/${entry}`
    const checkRes = await runWslDistroAsync(distro, ['cat', '--', `${dir}/${markerFile}`], { timeout: 10000 })
    if (checkRes.status === 0 && checkRes.stdout.trim() === marker) {
      sshHashCache.set(cacheKey, marker)
      return `${dir}/${entry}`
    }
    const env = getCachedWslEnv(distro)
    const nodeBin = env?.node || 'node'
    const payload = {
      dir,
      entry,
      markerFile,
      marker,
      mainB64: contents[0].toString('base64'),
      chunks: chunks.map((name, index) => ({ name, b64: contents[index + 1].toString('base64') })),
    }
    const writeRes = await runWslDistroAsync(distro, [nodeBin, '-e', SSH_BUNDLE_WRITE_JS], {
      input: JSON.stringify(payload),
      timeout: 45000,
    })
    if (writeRes.status !== 0) return null
    sshHashCache.set(cacheKey, marker)
    return `${dir}/${entry}`
  }

  const destination = wslPathToWindows(distro, dir)
  await mkdir(destination, { recursive: true })
  const markerPath = join(destination, markerFile)
  try {
    if (await readFile(markerPath, 'utf8') === marker) return `${dir}/${entry}`
  } catch {
    /* first sync */
  }
  await writeFile(join(destination, entry), contents[0])
  if (chunks.length) {
    await mkdir(join(destination, 'chunks'), { recursive: true })
    for (const [index, name] of chunks.entries()) {
      await writeFile(join(destination, 'chunks', name), contents[index + 1])
    }
  }
  await writeFile(join(destination, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  await writeFile(markerPath, marker, 'utf8')
  return `${dir}/${entry}`
}
