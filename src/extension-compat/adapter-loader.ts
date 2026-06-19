// adapter.json 加载与合并 (兼容层 v2 — docs/adapter-layer-plan.md §5)
// 优先级：项目级 .pi/desktop/adapters > 用户级 ~/.pi/desktop/adapters > 内置 builtin/*.adapter.json
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AdapterCatalog, AdapterJson, AdapterLoadError } from './adapter-schema'

// Builtin adapters are imported as modules so they survive bundling (no runtime fs read needed).
import piSearchAdapter from './builtin/pi-search.adapter.json'

const BUILTIN: AdapterJson[] = [piSearchAdapter as unknown as AdapterJson]
const USER_DIR = join(homedir(), '.pi', 'desktop', 'adapters')
let cachedCatalog: AdapterCatalog | null = null
let cachedProjectDir: string | null = null

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Minimal structural validation; unknown primitives gracefully degrade at render time.
function looksLikeAdapter(raw: unknown): raw is AdapterJson {
  return isPlainObject(raw) && typeof raw.id === 'string' && typeof raw.tier === 'string'
}

function readDir(dir: string): { name: string; text: string }[] {
  if (!existsSync(dir)) return []
  const out: { name: string; text: string }[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.adapter.json') && !f.endsWith('.json')) continue
    try {
      out.push({ name: f, text: readFileSync(join(dir, f), 'utf8') })
    } catch {
      // unreadable file — skip
    }
  }
  return out
}

function deepMerge(base: AdapterJson, override: AdapterJson): AdapterJson {
  return {
    ...base,
    ...override,
    match: {
      names: mergeUnique(base.match?.names, override.match?.names),
      tools: mergeUnique(base.match?.tools, override.match?.tools),
      commands: mergeUnique(base.match?.commands, override.match?.commands),
    },
    config: mergeConfig(base.config, override.config),
  }
}

function mergeUnique(a?: string[], b?: string[]): string[] | undefined {
  if (!b) return a
  if (!a) return b
  return Array.from(new Set([...a, ...b]))
}

function mergeConfig(a?: AdapterJson['config'], b?: AdapterJson['config']): AdapterJson['config'] | undefined {
  if (!b) return a
  if (!a) return b
  const merged = { ...a, ...b }
  // sections merge by field key (append non-duplicate fields), derived by label
  if (a.sections && b.sections) {
    merged.sections = [...a.sections, ...b.sections].reduce<AdapterJson['config']['sections']>((acc, sec) => {
      const existing = acc.find((s) => s?.title === sec?.title)
      if (existing) {
        existing.fields = mergeByKeys(existing.fields, sec.fields)
        existing.derived = mergeByLabels(existing.derived, sec.derived)
      } else {
        acc.push(sec)
      }
      return acc
    }, [])
  }
  return merged
}

function mergeByKeys<T extends { key: string }>(a?: T[], b?: T[]): T[] | undefined {
  if (!b) return a
  if (!a) return b
  const map = new Map(a.map((x) => [x.key, x]))
  for (const y of b) map.set(y.key, { ...map.get(y.key), ...y })
  return Array.from(map.values())
}

function mergeByLabels<T extends { label: string }>(a?: T[], b?: T[]): T[] | undefined {
  if (!b) return a
  if (!a) return b
  const map = new Map(a.map((x) => [x.label, x]))
  for (const y of b) map.set(y.label, y)
  return Array.from(map.values())
}

export function loadAdapterCatalog(projectDir?: string): AdapterCatalog {
  const projectOverrideDir = projectDir ? join(projectDir, '.pi', 'desktop', 'adapters') : null
  if (cachedCatalog && cachedProjectDir === (projectDir || null)) return cachedCatalog
  cachedProjectDir = projectDir || null

  const byId = new Map<string, AdapterJson>()
  const sources: Record<string, 'builtin' | 'override' | 'probe'> = {}
  const errors: AdapterLoadError[] = []

  // 1. builtin (lowest priority) — imported modules
  for (const raw of BUILTIN) {
    if (!looksLikeAdapter(raw)) {
      errors.push({ adapterId: raw?.id || 'unknown', source: 'builtin', message: 'invalid shape' })
      continue
    }
    byId.set(raw.id, raw)
    sources[raw.id] = 'builtin'
  }

  // 2. user override (~/.pi/desktop/adapters)
  for (const f of readDir(USER_DIR)) {
    try {
      const raw = JSON.parse(f.text)
      if (!looksLikeAdapter(raw)) {
        errors.push({ adapterId: f.name, source: 'override', message: 'invalid shape' })
        continue
      }
      const prev = byId.get(raw.id)
      byId.set(raw.id, prev ? deepMerge(prev, raw) : raw)
      sources[raw.id] = 'override'
    } catch (e: any) {
      errors.push({ adapterId: f.name, source: 'override', message: e.message })
    }
  }

  // 3. project override (<project>/.pi/desktop/adapters) — highest priority
  if (projectOverrideDir) {
    for (const f of readDir(projectOverrideDir)) {
      try {
        const raw = JSON.parse(f.text)
        if (!looksLikeAdapter(raw)) {
          errors.push({ adapterId: f.name, source: 'override', message: 'invalid shape' })
          continue
        }
        const prev = byId.get(raw.id)
        byId.set(raw.id, prev ? deepMerge(prev, raw) : raw)
        sources[raw.id] = 'override'
      } catch (e: any) {
        errors.push({ adapterId: f.name, source: 'override', message: e.message })
      }
    }
  }

  cachedCatalog = { adapters: Array.from(byId.values()), errors, sources }
  return cachedCatalog
}

export function invalidateAdapterCatalog(): void {
  cachedCatalog = null
  cachedProjectDir = null
}

export function findAdapterByTool(toolName: string, projectDir?: string): AdapterJson | undefined {
  return loadAdapterCatalog(projectDir).adapters.find((a) => a.match?.tools?.includes(toolName))
}

export function findAdapterById(id: string, projectDir?: string): AdapterJson | undefined {
  return loadAdapterCatalog(projectDir).adapters.find((a) => a.id === id)
}
