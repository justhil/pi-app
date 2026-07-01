#!/usr/bin/env node
/**
 * Compare probed pi extensions vs builtin adapter.json catalog.
 * Run: node scripts/audit-adapters.mjs [projectCwd]
 */
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const require = createRequire(import.meta.url)

// Load compiled paths via ts-node not available — use dynamic import of built output or read JSON only
import { readdirSync, readFileSync } from 'fs'

const cwd = process.argv[2] || root
const builtinDir = join(root, 'src/extension-compat/builtin')

function loadBuiltinAdapters() {
  const files = readdirSync(builtinDir).filter((f) => f.endsWith('.adapter.json'))
  return files.map((f) => {
    const j = JSON.parse(readFileSync(join(builtinDir, f), 'utf8'))
    return { file: f, id: j.id, tier: j.tier, names: j.match?.names || [], tools: j.match?.tools || [] }
  })
}

const builtins = loadBuiltinAdapters()
console.log(`Builtin adapter files: ${builtins.length}`)
console.log('tier=none:', builtins.filter((b) => b.tier === 'none').map((b) => b.id).join(', ') || '(none)')

// Probe requires TS — document manual step
console.log('\nTo compare with installed extensions, run in dev shell:')
console.log('  npm run typecheck && node --experimental-vm-modules (or use Settings → Extensions UI)')
console.log('\nBuiltin tool coverage (unique tools):', [...new Set(builtins.flatMap((b) => b.tools))].sort().join(', '))