// 通用适配器配置后端 (兼容层 v2 — docs/adapter-layer-plan.md §6)
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

function readSharedFile(path: string): Record<string, unknown> {
  const full = expandPath(path)
  if (!existsSync(full)) return {}
  try {
    return JSON.parse(readFileSync(full, 'utf8'))
  } catch {
    return {}
  }
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
    } catch {
      // best-effort backup
    }
  }
  renameSync(tmp, full)
}

/** Read adapter config as a renderable view: env-override applied, secrets masked, derived flags computed. */
export function readAdapterConfig(adapterId: string, workspaceId: string): Record<string, unknown> {
  const adapter = findAdapterById(adapterId)
  const cfg = adapter?.config
  if (cfg?.configFile) {
    const file = readSharedFile(cfg.configFile)
    const fileKeyMap = cfg.fileKeyMap || {}
    const envOverride = cfg.envOverride || {}
    const view: Record<string, unknown> = {}
    for (const [formKey, fileKey] of Object.entries(fileKeyMap)) {
      const field = (cfg.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === formKey)
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
  return configStore.getExtensionConfig(workspaceId, adapterId) || {}
}

/** Apply a patch: shared-file respects fileKeyMap + secret-skip-empty; app-local stores as-is. */
export function writeAdapterConfig(adapterId: string, workspaceId: string, patch: Record<string, unknown>): Record<string, unknown> {
  const adapter = findAdapterById(adapterId)
  const cfg = adapter?.config
  if (cfg?.configFile) {
    const file = readSharedFile(cfg.configFile)
    const fileKeyMap = cfg.fileKeyMap || {}
    const fields = new Map<string, ConfigField>(
      (cfg.sections || []).flatMap((s) => s.fields || []).map((f) => [f.key, f]),
    )
    for (const [formKey, val] of Object.entries(patch)) {
      if (val === undefined) continue
      const fileKey = fileKeyMap[formKey]
      if (!fileKey) continue
      const field = fields.get(formKey)
      // secret: skip empty / masked-unchanged
      if (field?.type === 'secret') {
        const s = String(val)
        if (!s) continue
        if (s.includes('…')) continue
        file[fileKey] = s
        continue
      }
      if (val === '') continue
      file[fileKey] = val
    }
    atomicWrite(cfg.configFile, JSON.stringify(file, null, 2))
    return readAdapterConfig(adapterId, workspaceId)
  }
  const existing = configStore.getExtensionConfig(workspaceId, adapterId) || {}
  const next = { ...existing, ...patch }
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
    const view = readAdapterConfig(adapterId, '')
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
      } as any)
      const elapsed = 0
      if (res.ok) {
        let extra = ''
        if (action.report?.countPath) {
          const data: any = await res.json().catch(() => null)
          const n = pickPath(data, action.report.countPath)
          extra = `，${action.report.label || 'count'}: ${n}`
        }
        lines.push(`✅ ${method} ${url} HTTP ${res.status}${extra}`)
      } else {
        lines.push(`❌ ${method} ${url} HTTP ${res.status}`)
        ok = false
      }
    } catch (e: any) {
      lines.push(`❌ ${method} ${url}: ${e?.message || e}`)
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

function pickPath(data: any, path: string): unknown {
  if (!data) return undefined
  const parts = path.replace(/^\$\.?/, '').split('.')
  let cur: any = data
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
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
  // Note: env-override values (e.g. real API keys) are NOT exposed in the masked view,
  // so read the raw shared file / env to template the request.
  const view = readAdapterConfig(adapterId, '')
  // Backfill raw secret from env / shared file for the request header (not returned to renderer).
  const rawView: Record<string, unknown> = { ...view }
  const envOverride = adapter?.config?.envOverride || {}
  for (const [formKey, envName] of Object.entries(envOverride)) {
    if (process.env[envName] && !rawView[formKey]) rawView[formKey] = process.env[envName]
  }
  const url = tpl(src.url, rawView)
  const headers = mapTpl(src.headers || {}, rawView)
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(src.timeoutMs || 15000) } as any)
    if (!res.ok) return { options: [], error: `HTTP ${res.status}` }
    const data: any = await res.json().catch(() => null)
    const items = pickPath(data, src.itemsPath)
    if (!Array.isArray(items)) return { options: [], error: 'itemsPath not an array' }
    const valueKey = src.valueFrom || 'id'
    const labelKey = src.labelFrom || valueKey
    const options = items.map((it: any) => {
      if (typeof it === 'string') return it
      const val = it?.[valueKey]
      const lab = it?.[labelKey]
      return lab && lab !== val ? `${lab} (${val})` : String(val ?? '')
    }).filter(Boolean)
    return { options }
  } catch (e: any) {
    return { options: [], error: e?.message || String(e) }
  }
}
