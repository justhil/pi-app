// 通用适配器配置后端 (兼容层 v2 — doc/adapter-layer-plan.md §6)
// 按 adapter.config.persistence 分派：声明 configFile => shared-file（原子写+备份+env覆盖+fileKeyMap+secret不覆盖）；
// 否则 app-local (configStore)。取代原先的 per-plugin config 后端。
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { configStore } from '../main/config-store'
import { findAdapterById } from './adapter-loader'
import type { AdapterJson, ConfigField } from './adapter-schema'

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

function expandPath(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

type SharedFileRead =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: 'invalid_json' }

function readSharedFile(path: string): SharedFileRead {
  const full = expandPath(path)
  if (!existsSync(full)) return { ok: true, data: {} }
  try {
    const parsed = JSON.parse(readFileSync(full, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'invalid_json' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: 'invalid_json' }
  }
}

/** Path to the pi global settings.json (~/.pi/agent/settings.json). */
function piSettingsPath(): string {
  return join(homedir(), '.pi', 'agent', 'settings.json')
}

/** Read a single top-level key from pi global settings.json. */
function readPiSettingsKey(key: string): unknown {
  const p = piSettingsPath()
  if (!existsSync(p)) return undefined
  try {
    const obj = JSON.parse(readFileSync(p, 'utf8'))
    return obj?.[key]
  } catch (e) {
    return undefined
  }
}

/** Atomically write a single top-level key into pi global settings.json. */
function writePiSettingsKey(key: string, value: unknown): void {
  const p = piSettingsPath()
  let obj: Record<string, unknown> = {}
  if (existsSync(p)) {
    try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { obj = {} }
  }
  obj[key] = value
  atomicWrite(p, JSON.stringify(obj, null, 2))
}

function atomicWrite(path: string, data: string): void {
  const full = expandPath(path)
  mkdirSync(dirname(full), { recursive: true })
  const tmp = `${full}.tmp`
  writeFileSync(tmp, data, 'utf8')
  // backup before replace (keep one .bak)
  if (existsSync(full)) {
    try {
      renameSync(full, `${full}.bak`)
    } catch (e) {
      // best-effort backup
    }
  }
  renameSync(tmp, full)
}

/** Read adapter config as a renderable view: env-override applied, secrets masked, derived flags computed.
 *  configFile fields come from the shared file; localKeys come from app-local configStore. */
export function readAdapterConfig(adapterId: string, workspaceId: string): Record<string, unknown> {
  const adapter = findAdapterById(adapterId)
  const cfg = adapter?.config
  const localKeys = new Set(cfg?.localKeys || [])
  const local = configStore.getExtensionConfig(workspaceId, adapterId) || {}

  // pi flag-backed settings (e.g. fff-mode): read from ~/.pi/agent/settings.json
  if (cfg?.piSettingsKey) {
    const key = cfg.piSettingsKey
    const field = (cfg.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === key)
    const val = readPiSettingsKey(key)
    return { [key]: val ?? field?.default ?? '', __piSettings: true }
  }

  if (cfg?.configFile) {
    const fileRead = readSharedFile(cfg.configFile)
    if (!fileRead.ok) {
      return { __configFile: cfg.configFile, __configFileError: fileRead.error }
    }
    const file = fileRead.data
    const fileKeyMap = cfg.fileKeyMap || {}
    const envOverride = cfg.envOverride || {}
    const view: Record<string, unknown> = {}
    const allKeys = new Set<string>([
      ...Object.keys(fileKeyMap),
      ...(cfg.sections || []).flatMap((s) => s.fields || []).map((f) => f.key),
    ])
    for (const formKey of allKeys) {
      const field = (cfg.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === formKey)
      if (localKeys.has(formKey)) {
        view[formKey] = local[formKey] ?? field?.default ?? ''
        continue
      }
      const fileKey = fileKeyMap[formKey]
      if (!fileKey) continue
      const envName = envOverride[formKey]
      const rawVal = envName ? process.env[envName] : undefined
      const val = rawVal ?? file[fileKey]
      if (field?.type === 'secret') {
        view[formKey] = maskKey(String(val || ''))
        view[`${formKey}Set`] = !!(val && String(val).length)
      } else {
        view[formKey] = val ?? field?.default ?? ''
      }
    }
    view.__configFile = cfg.configFile
    return view
  }
  // app-local fallback (existing configStore path)
  return local
}

/** Read adapter config as RAW values (secrets NOT masked) for outbound HTTP requests
 *  (httpCheck / optionsFrom). Pulls env-override first, then shared file. */
export function readRawView(adapterId: string): Record<string, unknown> {
  const adapter = findAdapterById(adapterId)
  const cfg = adapter?.config
  if (cfg?.piSettingsKey) {
    return { [cfg.piSettingsKey]: readPiSettingsKey(cfg.piSettingsKey) }
  }
  if (!cfg?.configFile) {
    // app-local: no secrets masking in place, return as-is
    return configStore.getExtensionConfig('', adapterId) || {}
  }
  const fileRead = readSharedFile(cfg.configFile)
  if (!fileRead.ok) return {}
  const file = fileRead.data
  const fileKeyMap = cfg.fileKeyMap || {}
  const envOverride = cfg.envOverride || {}
  const view: Record<string, unknown> = {}
  for (const [formKey, fileKey] of Object.entries(fileKeyMap)) {
    const envName = envOverride[formKey]
    const val = (envName ? process.env[envName] : undefined) ?? file[fileKey]
    if (val !== undefined) view[formKey] = val
  }
  return view
}

/** Apply a patch: shared-file respects fileKeyMap + secret-skip-empty;
 *  localKeys go to app-local configStore. */
export function writeAdapterConfig(adapterId: string, workspaceId: string, patch: Record<string, unknown>): Record<string, unknown> {
  const adapter = findAdapterById(adapterId)
  const cfg = adapter?.config

  // pi flag-backed settings: write to ~/.pi/agent/settings.json
  if (cfg?.piSettingsKey) {
    const key = cfg.piSettingsKey
    if (patch[key] !== undefined) writePiSettingsKey(key, patch[key])
    return readAdapterConfig(adapterId, workspaceId)
  }

  const localKeys = new Set(cfg?.localKeys || [])
  // Always merge localKeys into app-local store (independent of configFile).
  const local = configStore.getExtensionConfig(workspaceId, adapterId) || {}
  let localDirty = false
  for (const [k, v] of Object.entries(patch)) {
    if (localKeys.has(k)) {
      local[k] = v
      localDirty = true
    }
  }
  if (cfg?.configFile) {
    const fileRead = readSharedFile(cfg.configFile)
    if (!fileRead.ok) {
      throw new Error('adapter config file is invalid JSON; repair the file before saving')
    }
    const file = { ...fileRead.data }
    const fileKeyMap = cfg.fileKeyMap || {}
    const fields = new Map<string, ConfigField>(
      (cfg.sections || []).flatMap((s) => s.fields || []).map((f) => [f.key, f]),
    )
    for (const [formKey, val] of Object.entries(patch)) {
      if (val === undefined) continue
      if (localKeys.has(formKey)) continue
      const fileKey = fileKeyMap[formKey]
      if (!fileKey) continue
      const field = fields.get(formKey)
      // secret: skip empty / masked-unchanged (maskKey uses • for short keys, … for long keys)
      if (field?.type === 'secret') {
        const s = String(val)
        if (!s) continue
        if (s.includes('•') || s.includes('…')) continue
        file[fileKey] = s
        continue
      }
      if (val === '') continue
      file[fileKey] = val
    }
    atomicWrite(cfg.configFile, JSON.stringify(file, null, 2))
    if (localDirty) configStore.setExtensionConfig(workspaceId, adapterId, local)
    return readAdapterConfig(adapterId, workspaceId)
  }
  const next = { ...local, ...patch }
  configStore.setExtensionConfig(workspaceId, adapterId, next)
  return next
}

/** Run a declared action (httpCheck/openPath/reload). Returns a serializable result. */
export async function runAdapterAction(adapterId: string, actionId: string): Promise<{ ok: boolean; lines?: string[]; error?: string }> {
  const adapter = findAdapterById(adapterId)
  const action = adapter?.config?.actions?.find((a) => a.id === actionId)
  if (!action) return { ok: false, error: 'action not found' }

  if (action.type === 'reload') {
    return { ok: true, lines: ['reloaded'] }
  }
  if (action.type === 'openPath') {
    const target = action.url || ''
    if (!target) return { ok: false, error: 'no path' }
    return { ok: true, lines: [target] }
  }
  if (action.type === 'httpCheck') {
    const view = readRawView(adapterId)
    const url = tpl(action.url || '', view)
    const headers = mapTpl(action.headers || {}, view)
    const method = (action.method || 'GET').toUpperCase()
    const lines: string[] = [`## ${action.label || actionId}\n`]
    let ok = true
    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(action.timeoutMs || 15000),
      })
      const elapsed = 0
      if (res.ok) {
        let extra = ''
        if (action.report?.countPath) {
          const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
          const n = pickPath(data, action.report.countPath)
          extra = `，${action.report.label || 'count'}: ${n}`
        }
        lines.push(`✅ ${method} ${url} HTTP ${res.status}${extra}`)
      } else {
        lines.push(`❌ ${method} ${url} HTTP ${res.status}`)
        ok = false
      }
    } catch (e: unknown) {
      lines.push(`❌ ${method} ${url}: ${e instanceof Error ? e.message : String(e)}`)
      ok = false
    }
    return { ok, lines }
  }
  return { ok: false, error: `unknown action type ${action.type}` }
}

function tpl(s: string, view: Record<string, unknown>): string {
  return s.replace(/\$\{(\w+)\??([^}]*)\}/g, (_m, key, rest) => {
    const v = view[key]
    if (rest && rest.startsWith(':')) {
      // ${cond?true:false} ternary form
      const [_c, _f] = rest.slice(1).split(':')
      return v ? _c : _f
    }
    return v != null ? String(v) : ''
  })
}

function mapTpl(obj: Record<string, string>, view: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = tpl(v, view)
  return out
}

function pickPath(data: unknown, path: string): unknown {
  if (!data || typeof data !== 'object') return undefined
  const parts = path.replace(/^\$\.?/, '').split('.')
  let cur: unknown = data
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** Fetch dynamic options for a select field (e.g. pi-search model list from its API). */
export async function fetchFieldOptions(adapterId: string, fieldKey: string): Promise<{ options: string[]; error?: string }> {
  const adapter = findAdapterById(adapterId)
  const field = (adapter?.config?.sections || [])
    .flatMap((s) => s.fields || [])
    .find((f) => f.key === fieldKey)
  const src = field?.optionsFrom
  if (!field || !src) return { options: [], error: 'field has no optionsFrom' }
  // Use raw (unmasked) values for the outbound request — secrets come from env / shared file.
  const view = readRawView(adapterId)
  const url = tpl(src.url, view)
  const headers = mapTpl(src.headers || {}, view)
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(src.timeoutMs || 15000) })
    if (!res.ok) return { options: [], error: `HTTP ${res.status}` }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const items = pickPath(data, src.itemsPath)
    if (!Array.isArray(items)) return { options: [], error: 'itemsPath not an array' }
    const valueKey = src.valueFrom || 'id'
    const labelKey = src.labelFrom || valueKey
    const options = items.map((it: unknown) => {
      if (typeof it === 'string') return it
      const row = typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : {}
      const val = row[valueKey]
      const lab = row[labelKey]
      return lab && lab !== val ? `${lab} (${val})` : String(val ?? '')
    }).filter(Boolean)
    return { options }
  } catch (e: unknown) {
    return { options: [], error: e instanceof Error ? e.message : String(e) }
  }
}
