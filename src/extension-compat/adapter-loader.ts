// adapter.json 加载与合并 (兼容层 v2 — doc/adapter-layer-plan.md §5)
// 优先级：项目 .pi/desktop/adapters > ~/.pi/desktop/adapters > builtin
// 外部文件按 match.names（扩展包名）覆盖内置整份适配器，而非仅同 id 深合并
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'path'
import { adapterIdentity, parseAdapterDeclaration } from './adapter-validation'
import { getActiveDesktopDir } from './active-dirs'
import type { AdapterCatalog, AdapterJson, AdapterLoadError, InteractDef } from './adapter-schema'

// Builtin adapters are imported as modules so they survive bundling (no runtime fs read needed).
import piSearchAdapter from './builtin/pi-search.adapter.json'
import trellisAdapter from './builtin/trellis.adapter.json'
import askAdapter from './builtin/rpiv-ask-user-question.adapter.json'
import imageGenAdapter from './builtin/pi-image-gen.adapter.json'
import multimodalAdapter from './builtin/pi-multimodal-proxy.adapter.json'
import markdownPreviewAdapter from './builtin/pi-markdown-preview.adapter.json'
import studioAdapter from './builtin/pi-studio.adapter.json'
import fastContextAdapter from './builtin/pi-fast-context.adapter.json'
import subagentsAdapter from './builtin/pi-subagents.adapter.json'
import cacheOptimizerAdapter from './builtin/pi-cache-optimizer.adapter.json'
import skillsManagerAdapter from './builtin/pi-skills-manager.adapter.json'
import mcpAdapter from './builtin/pi-mcp-adapter.adapter.json'
import contextViewerAdapter from './builtin/edb-context-viewer.adapter.json'
import fffAdapter from './builtin/pi-fff.adapter.json'
import syncAdapter from './builtin/pi-sync.adapter.json'
import rewindAdapter from './builtin/pi-rewind.adapter.json'
import continueAdapter from './builtin/pi-continue.adapter.json'
import goalAdapter from './builtin/pi-goal.adapter.json'
import btwAdapter from './builtin/pi-btw.adapter.json'
import simplifyAdapter from './builtin/pi-simplify.adapter.json'
import advisorAdapter from './builtin/rpiv-advisor.adapter.json'
import observationalMemoryAdapter from './builtin/pi-observational-memory.adapter.json'
import toolDisplayAdapter from './builtin/pi-tool-display.adapter.json'
import agentsmdAdapter from './builtin/pi-agentsmd.adapter.json'
import aceToolAdapter from './builtin/pi-ace-tool.adapter.json'
import sequentialThinkingAdapter from './builtin/pi-sequential-thinking.adapter.json'
import aegisAdapter from './builtin/aegis.adapter.json'
import tpsExtensionsAdapter from './builtin/pi-tps-extensions.adapter.json'
import nanoContextAdapter from './builtin/pi-nano-context.adapter.json'
import powerlineFooterAdapter from './builtin/pi-powerline-footer.adapter.json'
import ampThemesAdapter from './builtin/amp-themes.adapter.json'
import curatedThemesAdapter from './builtin/pi-curated-themes.adapter.json'
import themesBundleAdapter from './builtin/pi-themes-bundle.adapter.json'
import hashlineEditAdapter from './builtin/pi-hashline-edit.adapter.json'
import piDeckTodoAdapter from './builtin/pi-deck-todo.adapter.json'
import magicContextTodoAdapter from './builtin/magic-context-todo.adapter.json'

const BUILTIN: AdapterJson[] = [
  piSearchAdapter, trellisAdapter, askAdapter, imageGenAdapter, multimodalAdapter,
  markdownPreviewAdapter, studioAdapter, fastContextAdapter, subagentsAdapter,
  cacheOptimizerAdapter, skillsManagerAdapter, mcpAdapter, contextViewerAdapter, fffAdapter,
  syncAdapter, rewindAdapter, continueAdapter, goalAdapter, btwAdapter, simplifyAdapter,
  advisorAdapter, observationalMemoryAdapter, toolDisplayAdapter, agentsmdAdapter, aceToolAdapter,
  sequentialThinkingAdapter, aegisAdapter, tpsExtensionsAdapter, nanoContextAdapter,
  powerlineFooterAdapter, ampThemesAdapter, curatedThemesAdapter, themesBundleAdapter,
  hashlineEditAdapter, piDeckTodoAdapter, magicContextTodoAdapter,
].map((a) => a as unknown as AdapterJson)
type Cached = { catalog: AdapterCatalog; checkedAt: number; fingerprint?: string; promise?: Promise<AdapterCatalog> }
const catalogs = new Map<string, Cached>()
let generation = 0
const listeners = new Set<(catalog: AdapterCatalog, projectDir: string) => void>()

export function onAdapterCatalogChanged(listener: (catalog: AdapterCatalog, projectDir: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function installAdapterCatalog(projectDir: string, catalog: AdapterCatalog): void {
  catalogs.set(catalogKey(projectDir), { catalog, checkedAt: Date.now() })
}

function catalogKey(projectDir = ''): string {
  const key = `${getActiveDesktopDir()}|${projectDir ? resolve(projectDir) : ''}`
  return process.platform === 'win32' ? key.toLowerCase() : key
}

export function adapterPackageKeys(a: AdapterJson): string[] {
  return [...new Set([...(a.match?.names || []), a.id].map(adapterIdentity))]
}

export function adaptersSharePackage(a: AdapterJson, b: AdapterJson): boolean {
  const keys = new Set(adapterPackageKeys(a))
  return adapterPackageKeys(b).some((key) => keys.has(key))
}

function compileCatalog(layers: unknown[][], scope: string, errors: AdapterLoadError[] = []): AdapterCatalog {
  let adapters: AdapterJson[] = []
  const sources: AdapterCatalog['sources'] = {}
  for (const [layerIndex, layer] of layers.entries()) {
    const withinLayer: AdapterJson[] = []
    for (const raw of layer) {
      const parsed = parseAdapterDeclaration(raw)
      if ('error' in parsed) {
        errors.push({ adapterId: String((raw as { id?: unknown })?.id || 'unknown'), source: layerIndex ? 'override' : 'builtin', message: parsed.error })
        continue
      }
      const adapter = parsed.adapter
      if (withinLayer.some((other) => adaptersSharePackage(adapter, other))) {
        errors.push({ adapterId: adapter.id, source: 'override', message: 'conflicting adapter identity in the same layer' })
        continue
      }
      withinLayer.push(adapter)
    }
    for (const adapter of withinLayer) {
      adapters = adapters.filter((other) => !adaptersSharePackage(adapter, other))
      adapters.push(adapter)
      sources[adapter.id] = layerIndex ? 'override' : 'builtin'
    }
  }
  const claimed = new Map<string, string>()
  for (const adapter of adapters) {
    for (const key of [...(adapter.match.tools || []).map((name) => `tool:${name}`), ...Object.keys(adapter.slash || {}).map((name) => `command:${name}`)]) {
      const owner = claimed.get(key)
      if (owner && owner !== adapter.id) errors.push({ adapterId: adapter.id, source: sources[adapter.id], message: `${key} also claimed by ${owner}` })
      else claimed.set(key, adapter.id)
    }
  }
  const revision = createHash('sha256').update(JSON.stringify({ adapters, errors })).digest('hex').slice(0, 16)
  return { adapters, errors, sources: Object.fromEntries(adapters.map((a) => [a.id, sources[a.id]])), scope, revision }
}

const builtinCatalog = compileCatalog([BUILTIN], 'builtin')

/** Synchronous consumers only query prepared snapshots; never perform filesystem I/O. */
export function loadAdapterCatalog(projectDir?: string): AdapterCatalog {
  return catalogs.get(catalogKey(projectDir))?.catalog ?? builtinCatalog
}

async function readDeclarations(dir: string, errors: AdapterLoadError[]): Promise<unknown[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const out: unknown[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    try {
      const path = join(dir, name)
      if ((await stat(path)).size > 256 * 1024) throw new Error('adapter file exceeds 256KB')
      const parsed = parseAdapterDeclaration(JSON.parse(await readFile(path, 'utf8')))
      if ('error' in parsed) throw new Error(parsed.error)
      out.push(parsed.adapter)
    } catch (error) {
      errors.push({ adapterId: name, source: 'override', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return out
}

export function prepareAdapterCatalog(projectDir?: string, options?: { refresh?: boolean }): Promise<AdapterCatalog> {
  const key = catalogKey(projectDir)
  const previous = catalogs.get(key)
  const previousRevision = previous?.catalog.revision
  if (previous?.promise) return previous.promise
  if (previous && !options?.refresh && Date.now() - previous.checkedAt < 1000) return Promise.resolve(previous.catalog)
  const epoch = generation
  const desktopDir = getActiveDesktopDir()
  const entry: Cached = previous ?? { catalog: builtinCatalog, checkedAt: 0 }
  const job = (async () => {
    const dirs = [join(desktopDir, 'adapters'), ...(projectDir ? [join(projectDir, '.pi', 'desktop', 'adapters')] : [])]
    const fingerprints = await Promise.all(dirs.map(async (dir) => {
      const names = (await readdir(dir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })).filter((name) => name.endsWith('.json')).sort()
      return Promise.all(names.map(async (name) => {
        const info = await stat(join(dir, name))
        return `${name}:${info.size}:${info.mtimeMs}`
      }))
    }))
    const fingerprint = JSON.stringify(fingerprints)
    if (previous?.fingerprint === fingerprint && !options?.refresh) {
      previous.checkedAt = Date.now()
      return previous.catalog
    }
    const errors: AdapterLoadError[] = []
    const user = await readDeclarations(dirs[0], errors)
    const project = dirs[1] ? await readDeclarations(dirs[1], errors) : []
    const next = compileCatalog([BUILTIN, user, project], key, errors)
    if (epoch === generation) {
      entry.catalog = previous && previous.catalog.revision === next.revision ? previous.catalog : next
      entry.checkedAt = Date.now()
      entry.fingerprint = fingerprint
      catalogs.set(key, entry)
      if (previousRevision !== next.revision) {
        for (const listener of listeners) listener(entry.catalog, projectDir ?? '')
      }
    }
    return entry.catalog
  })().finally(() => { if (entry.promise === job) entry.promise = undefined })
  entry.promise = job
  catalogs.set(key, entry)
  return job
}

export function invalidateAdapterCatalog(): void {
  generation++
  catalogs.clear()
}

export function findAdapterByTool(toolName: string, projectDir?: string): AdapterJson | undefined {
  return loadAdapterCatalog(projectDir).adapters.find((a) => a.match?.tools?.includes(toolName))
}

export function findAdapterById(id: string, projectDir?: string): AdapterJson | undefined {
  return loadAdapterCatalog(projectDir).adapters.find((a) => a.id === id)
}

// ── v2 query helpers (used by probe / slash.resolve / subpage to prefer v2 over v1 registry) ──

/** Build toolName → adapterId map from all v2 adapters. */
export function v2ToolMap(projectDir?: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    for (const t of a.match?.tools || []) map[t] = a.id
  }
  return map
}

export type V2SlashResolve = {
  adapterId: string
  behavior: 'notify' | 'config-page' | 'execute' | 'open-panel'
  matchNames: string[]
  desktopSupport?: string
  panelId?: string
}

function v2SlashFromAdapter(a: AdapterJson, cmd: string, behavior: V2SlashResolve['behavior']): V2SlashResolve {
  return {
    adapterId: a.id,
    behavior,
    matchNames: a.match?.names || [],
    desktopSupport: a.description,
    panelId:
      behavior === 'open-panel'
        ? a.sidePanel?.panelId || `adapter:${a.id}`
        : undefined,
  }
}

/** Resolve slash command behavior from v2 catalog. Returns null if no v2 adapter claims it. */
export function resolveV2Slash(commandName: string, projectDir?: string): V2SlashResolve | null {
  const cmd = commandName.startsWith('/') ? commandName : `/${commandName}`
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    const behavior = a.slash?.[cmd]
    if (behavior) {
      return v2SlashFromAdapter(a, cmd, behavior)
    }
    if (a.match?.commands?.includes(cmd) && !a.slash?.[cmd]) {
      return v2SlashFromAdapter(a, cmd, 'notify')
    }
  }
  return null
}

/**
 * Whether `probe` (without leading `/`) is a TUI-style glued form of catalog invocation `inv`.
 * Examples allowed: goalfoo from inv "goal".
 * Examples rejected: skill:my-skill from inv "skill" — colon starts a different command family
 * (pi skills use `/skill:name`, skills-manager only owns bare `/skill` and `/skill:enable`).
 */
export function isStickySlashContinuation(probe: string, inv: string): boolean {
  if (!inv || !probe) return false
  if (probe === inv) return true
  if (!probe.startsWith(inv) || probe.length <= inv.length) return false
  const nextChar = probe.charAt(inv.length)
  // Only alphanumeric / _ / - may glue onto a short slash command (e.g. /goalfoo).
  // Colon, slash, and other punctuation must not trigger sticky prefix matching.
  return /[A-Za-z0-9_-]/.test(nextChar)
}

/** TUI-style `/goalfoo` without space: match adapter by command prefix (e.g. `/goal`). */
export function resolveV2SlashPrefix(commandName: string, projectDir?: string): V2SlashResolve | null {
  const exact = resolveV2Slash(commandName, projectDir)
  if (exact) return exact
  const raw = commandName.startsWith('/') ? commandName : `/${commandName}`
  // Drop trailing args if any slipped into the token (router usually passes first token only).
  const token = raw.split(/\s+/, 1)[0] || raw
  const probe = token.slice(1)
  if (!probe) return null
  let best: { invLen: number; result: V2SlashResolve } | null = null
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    const candidates = new Set<string>()
    for (const c of a.match?.commands || []) {
      candidates.add(c.startsWith('/') ? c.slice(1) : c)
    }
    for (const key of Object.keys(a.slash || {})) {
      candidates.add(key.startsWith('/') ? key.slice(1) : key)
    }
    for (const inv of candidates) {
      if (!inv) continue
      if (!isStickySlashContinuation(probe, inv)) continue
      const cmd = `/${inv}`
      const behavior = a.slash?.[cmd] ?? (a.match?.commands?.includes(cmd) ? 'notify' : null)
      if (!behavior) continue
      if (!best || inv.length > best.invLen) {
        best = { invLen: inv.length, result: v2SlashFromAdapter(a, cmd, behavior) }
      }
    }
  }
  return best?.result ?? null
}

/** Display info for a v2 adapter (subpage header): tools/commands come from match + slash keys. */
export function v2DisplayInfo(adapterId: string, projectDir?: string): {
  displayName?: string
  description?: string
  registeredTools: string[]
  registeredCommands: string[]
} | null {
  const a = findAdapterById(adapterId, projectDir)
  if (!a) return null
  const slashCmds = Object.keys(a.slash || {})
  const matchCmds = (a.match?.commands || []).map((c) => (c.startsWith('/') ? c : `/${c}`))
  return {
    displayName: a.displayName || a.id,
    description: a.description,
    registeredTools: a.match?.tools || [],
    registeredCommands: Array.from(new Set([...slashCmds, ...matchCmds])),
  }
}

/** Resolve interact definition for a tool (trigger.tool match). Returns schema + field mappings. */
export function resolveInteractByTool(
  toolName: string,
  projectDir?: string,
): { adapterId: string; schema: InteractDef['schema']; fields?: Record<string, string> } | null {
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    const interact = a.interact
    if (interact?.trigger?.tool === toolName) {
      return { adapterId: a.id, schema: interact.schema, fields: interact.fields }
    }
  }
  return null
}

function norm(s: string): string {
  return adapterIdentity(s)
}

/** Resolve an installed plugin (by name / packageName) to its v2 adapter.
 *  Replaces v1 resolvePluginAdapterMeta. Returns null if no v2 adapter claims it. */
export function resolveV2ByPluginName(
  name: string,
  packageName?: string,
  projectDir?: string,
): AdapterJson | null {
  const candidates = [name, packageName].filter(Boolean) as string[]
  if (candidates.length === 0) return null
  const norms = candidates.map(norm)
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    const names = (a.match?.names || []).map(norm)
    if (names.some((n) => norms.some((c) => c === n))) {
      return a
    }
  }
  return null
}
