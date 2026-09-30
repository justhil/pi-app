import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { wslPathToWindows } from '@shared/wsl-path'
import { resolveUtilityEntry } from '../utility-entry-path'
import { wslHomeDir } from './wsl-exec'

const pending = new Map<string, Promise<string | null>>()

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
  const destination = wslPathToWindows(distro, dir)
  await mkdir(destination, { recursive: true })
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
  const markerPath = join(destination, entry.replace(/\.mjs$/, '.hash'))
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
