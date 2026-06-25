// adapter.json 加载与合并 (兼容层 v2 — doc/adapter-layer-plan.md §5)
// 优先级：项目 .pi/desktop/adapters > ~/.pi/desktop/adapters > builtin
// 外部文件按 match.names（扩展包名）覆盖内置整份适配器，而非仅同 id 深合并
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
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

const BUILTIN: AdapterJson[] = [
  piSearchAdapter, trellisAdapter, askAdapter, imageGenAdapter, multimodalAdapter,
  markdownPreviewAdapter, studioAdapter, fastContextAdapter, subagentsAdapter,
  cacheOptimizerAdapter, skillsManagerAdapter, mcpAdapter, contextViewerAdapter, fffAdapter,
  syncAdapter, rewindAdapter, continueAdapter, goalAdapter, btwAdapter, simplifyAdapter,
  advisorAdapter, observationalMemoryAdapter, toolDisplayAdapter, agentsmdAdapter, aceToolAdapter,
  sequentialThinkingAdapter, aegisAdapter, tpsExtensionsAdapter, nanoContextAdapter,
  powerlineFooterAdapter, ampThemesAdapter, curatedThemesAdapter, themesBundleAdapter,
  hashlineEditAdapter,
].map((a) => a as unknown as AdapterJson)
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

/** 用于覆盖判定的包名键（match.names + id） */
export function adapterPackageKeys(a: AdapterJson): string[] {
  const names = [...(a.match?.names || []), a.id]
  return Array.from(new Set(names.map(norm)))
}

/** 两适配器是否认领同一扩展包（与 resolveV2ByPluginName 同套模糊规则） */
export function adaptersSharePackage(a: AdapterJson, b: AdapterJson): boolean {
  const keysA = adapterPackageKeys(a)
  const keysB = adapterPackageKeys(b)
  for (const ka of keysA) {
    for (const kb of keysB) {
      if (ka === kb || ka.endsWith(kb) || kb.endsWith(ka) || ka.includes(kb) || kb.includes(ka)) {
        return true
      }
    }
  }
  return false
}

function parseAdapterFiles(files: { name: string; text: string }[], errors: AdapterLoadError[]): AdapterJson[] {
  const out: AdapterJson[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(f.text)
      if (!looksLikeAdapter(raw)) {
        errors.push({ adapterId: f.name, source: 'override', message: 'invalid shape' })
        continue
      }
      out.push(raw)
    } catch (e: any) {
      errors.push({ adapterId: f.name, source: 'override', message: e.message })
    }
  }
  return out
}

/**
 * 外部层整份替换：凡 match.names 与外部适配器重合的内置/低优先级项移除，再追加外部（可更新 id）。
 */
function applyPackageOverrides(base: AdapterJson[], overrides: AdapterJson[]): AdapterJson[] {
  let list = [...base]
  for (const ext of overrides) {
    list = list.filter((b) => !adaptersSharePackage(ext, b))
    list.push(ext)
  }
  return list
}

export function loadAdapterCatalog(projectDir?: string): AdapterCatalog {
  const projectOverrideDir = projectDir ? join(projectDir, '.pi', 'desktop', 'adapters') : null
  if (cachedCatalog && cachedProjectDir === (projectDir || null)) return cachedCatalog
  cachedProjectDir = projectDir || null

  const errors: AdapterLoadError[] = []
  const sources: Record<string, 'builtin' | 'override' | 'probe'> = {}

  let adapters: AdapterJson[] = []
  for (const raw of BUILTIN) {
    if (!looksLikeAdapter(raw)) {
      errors.push({ adapterId: (raw as { id?: string })?.id || 'unknown', source: 'builtin', message: 'invalid shape' })
      continue
    }
    adapters.push(raw)
    sources[raw.id] = 'builtin'
  }

  const userOverrides = parseAdapterFiles(readDir(USER_DIR), errors)
  adapters = applyPackageOverrides(adapters, userOverrides)
  for (const a of userOverrides) sources[a.id] = 'override'

  if (projectOverrideDir) {
    const projectOverrides = parseAdapterFiles(readDir(projectOverrideDir), errors)
    adapters = applyPackageOverrides(adapters, projectOverrides)
    for (const a of projectOverrides) sources[a.id] = 'override'
  }

  // 重建 sources：仍在列表中的 builtin 保留 builtin，其余 override
  const finalSources: Record<string, 'builtin' | 'override' | 'probe'> = {}
  const builtinIds = new Set(BUILTIN.filter(looksLikeAdapter).map((b) => b.id))
  for (const a of adapters) {
    finalSources[a.id] = sources[a.id] === 'override' ? 'override' : builtinIds.has(a.id) ? 'builtin' : 'override'
  }

  cachedCatalog = { adapters, errors, sources: finalSources }
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

// ── v2 query helpers (used by probe / slash.resolve / subpage to prefer v2 over v1 registry) ──

/** Build toolName → adapterId map from all v2 adapters. */
export function v2ToolMap(projectDir?: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    for (const t of a.match?.tools || []) map[t] = a.id
  }
  return map
}

/** Resolve slash command behavior from v2 catalog. Returns null if no v2 adapter claims it. */
export function resolveV2Slash(
  commandName: string,
  projectDir?: string,
): {
  adapterId: string
  behavior: 'notify' | 'config-page' | 'execute' | 'open-panel'
  matchNames: string[]
  desktopSupport?: string
  panelId?: string
} | null {
  const cmd = commandName.startsWith('/') ? commandName : `/${commandName}`
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    const behavior = a.slash?.[cmd]
    if (behavior) {
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
    // match.commands also implies the adapter claims this command; default to notify if no slash entry
    if (a.match?.commands?.includes(cmd) && !a.slash?.[cmd]) {
      return { adapterId: a.id, behavior: 'notify', matchNames: a.match?.names || [], desktopSupport: a.description }
    }
  }
  return null
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
  return s.toLowerCase().replace(/^package:/, '')
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
    if (names.some((n) => norms.some((c) => c === n || c.endsWith(n) || c.includes(n)))) {
      return a
    }
  }
  return null
}
