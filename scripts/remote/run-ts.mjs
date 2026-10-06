// Bundle a TS entry (with the @shared alias) and run it. Used by remote-dev-host / remote-probe.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function runTs(entry) {
  const root = resolve(import.meta.dirname, '../..')
  const outdir = resolve(root, 'node_modules/.cache/remote-dev')
  mkdirSync(outdir, { recursive: true })
  const outfile = resolve(outdir, basename(entry).replace(/\.ts$/, '.mjs'))
  await build({
    entryPoints: [resolve(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    alias: { '@shared': resolve(root, 'packages/shared') },
    logLevel: 'warning',
  })
  await import(pathToFileURL(outfile).href)
}
