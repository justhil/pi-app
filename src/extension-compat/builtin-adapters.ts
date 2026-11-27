import type { AdapterJson } from './adapter-schema'

// Auto-collect every builtin `*.adapter.json` at build/test time so adding a new builtin adapter
// only requires dropping a JSON file into `src/extension-compat/builtin/` (no manual import list).
const builtinModules = import.meta.glob<AdapterJson>('./builtin/*.adapter.json', {
  eager: true,
  import: 'default',
})

function stem(filePath: string): string {
  return filePath.replace(/^.*\//, '').replace(/\.adapter\.json$/i, '')
}

// Sort by base stem (not full path with '.adapter.json') so shorter exact names like `pi-goal`
// and `pi-rewind` deterministically precede hyphenated siblings (`pi-goal-x`, `pi-rewind-hook`).
export const BUILTIN_ADAPTERS: AdapterJson[] = Object.entries(builtinModules)
  .sort(([left], [right]) => stem(left).localeCompare(stem(right)))
  .map(([, mod]) => mod as AdapterJson)
