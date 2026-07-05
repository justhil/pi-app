#!/usr/bin/env node
/**
 * Write SHA256SUMS.txt for release artifacts in a directory (sorted, deterministic).
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SKIP_NAMES = new Set(['SHA256SUMS.txt', 'SHA256SUMS', 'sbom.json', 'sbom.cdx.json'])

async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => hash.update(c))
      .on('end', resolve)
      .on('error', reject)
  })
  return hash.digest('hex')
}

async function listFiles(dir) {
  const out = []
  async function walk(base) {
    const entries = await readdir(base, { withFileTypes: true })
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(base, ent.name)
      if (ent.isDirectory()) await walk(full)
      else if (ent.isFile()) out.push(full)
    }
  }
  await walk(dir)
  return out
}

export async function generateChecksums(artifactDir, outputPath = join(artifactDir, 'SHA256SUMS.txt')) {
  const files = (await listFiles(artifactDir)).filter((f) => !SKIP_NAMES.has(f.split(/[/\\]/).pop() || ''))
  const lines = []
  for (const file of files.sort((a, b) => relative(artifactDir, a).localeCompare(relative(artifactDir, b)))) {
    const st = await stat(file)
    if (!st.isFile() || st.size === 0) continue
    const rel = relative(artifactDir, file).replace(/\\/g, '/')
    const digest = await sha256File(file)
    lines.push(`${digest}  ${rel}`)
  }
  const body = `${lines.join('\n')}\n`
  await writeFile(outputPath, body, 'utf8')
  return { count: lines.length, outputPath, body }
}

const dir = process.argv[2]
if (dir) {
  const r = await generateChecksums(dir)
  console.log(`[release-checksums] wrote ${r.count} entries to ${r.outputPath}`)
}