#!/usr/bin/env node
/**
 * Generate a minimal CycloneDX-style SBOM from package-lock (production deps only).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function generateSbom(rootDir = process.cwd(), outputPath = join(rootDir, 'sbom.cdx.json')) {
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf8'))
  const prodNames = new Set(Object.keys(pkg.dependencies || {}))
  const components = []
  for (const [name, entry] of Object.entries(lock.packages || {})) {
    if (!name || name === '') continue
    const short = name.replace(/^node_modules\//, '')
    const top = short.split('node_modules/').pop()
    if (!prodNames.has(top)) continue
    if (components.some((c) => c.name === top)) continue
    components.push({
      type: 'library',
      name: top,
      version: entry.version || 'unknown',
      'bom-ref': `pkg:npm/${top}@${entry.version || 'unknown'}`,
    })
  }
  components.sort((a, b) => a.name.localeCompare(b.name))
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: { type: 'application', name: pkg.name, version: pkg.version },
    },
    components,
  }
  await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8')
  return { outputPath, componentCount: components.length }
}

const invokedAsCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('generate-release-sbom.mjs')
if (invokedAsCli) {
  const out = process.argv[2]
  const root = process.cwd()
  const outputPath = out ? join(root, out) : join(root, 'sbom.cdx.json')
  const r = await generateSbom(root, outputPath)
  console.log(`[release-sbom] wrote ${r.componentCount} components to ${r.outputPath}`)
}