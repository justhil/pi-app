import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  defaultAgentPurgePersonas,
  normalizeAgentPurgeConfig,
  normalizePurgeMode,
  normalizePurgedSessionKey,
  normalizePurgedSessionsMap,
  parsePersonaMarkdown,
  type ActivePurgePayload,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
  type PurgedSessionRecord,
} from '@shared/agent-purge'
import type { configStore as ConfigStoreType } from './config-store'

let cachedStore: typeof ConfigStoreType | null = null
function store(): typeof ConfigStoreType {
  if (!cachedStore) {
    // Lazy load so modules importing agent-purge-service stay importable in pure-Node unit tests without Electron app context.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedStore = (require('./config-store') as { configStore: typeof ConfigStoreType }).configStore
  }
  return cachedStore
}

const IGNORED_MD_NAMES = new Set([
  'readme.md',
  'readme_zh.md',
  'readme.zh.md',
  'readme.zh-cn.md',
  'readme.en.md',
  'readme.ja.md',
  'license.md',
  'licence.md',
  'changelog.md',
  'contributing.md',
  'security.md',
  'active.md',
])

export function resolveLocalAgentPurgePersonasDir(): string {
  const env = process.env.AGENT_PURGE_HOME?.trim()
  const home = !env ? join(homedir(), '.agent-purge') : isAbsolute(env) ? env : resolve(env)
  return join(home, 'personas')
}

export function getAgentPurgeConfig(): AgentPurgeConfig {
  return normalizeAgentPurgeConfig(store().get('agentPurgeConfig'))
}

export function saveAgentPurgeConfig(raw: unknown): AgentPurgeConfig {
  const normalized = normalizeAgentPurgeConfig(raw)
  store().set('agentPurgeConfig', normalized)
  return normalized
}

export function resetBuiltinPurgePersonas(): AgentPurgeConfig {
  const current = getAgentPurgeConfig()
  const builtins = defaultAgentPurgePersonas()
  const builtinIds = new Set(builtins.map((b) => b.id))
  const custom = current.personas.filter((p) => !builtinIds.has(p.id))
  return saveAgentPurgeConfig({
    ...current,
    personas: [...builtins, ...custom],
  })
}

export function getPurgedSessions(): Record<string, PurgedSessionRecord> {
  return normalizePurgedSessionsMap(store().get('purgedSessions'))
}

export function getActivePurgeForSession(sessionFile: string | null | undefined): ActivePurgePayload | null {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return null
  const record = getPurgedSessions()[key]
  if (!record || !record.body.trim()) return null
  return {
    personaId: record.personaId,
    personaName: record.personaName,
    mode: record.mode,
    body: record.body,
  }
}

/** Check whether a session JSONL file already contains any user or assistant message turns. */
export function sessionFileHasPriorTurns(sessionFile: string | undefined): boolean {
  if (!sessionFile || !existsSync(sessionFile)) return false
  try {
    const stat = statSync(sessionFile)
    if (stat.size === 0) return false
    const raw = readFileSync(sessionFile, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed) as { type?: string; message?: { role?: string } }
        if (entry?.type === 'message') {
          const role = entry.message?.role
          if (role === 'user' || role === 'assistant') return true
        }
      } catch {
        /* ignore malformed line */
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Lock Agent Purge onto `sessionFile` if and only if:
 * 1) `req.enabled` is true,
 * 2) `sessionFile` is not already locked, and
 * 3) `sessionFile` has no prior user/assistant turns on disk (first message of a new chat only).
 */
export function maybeLockPurgedSessionOnSend(
  sessionFile: string | undefined,
  req?: { enabled?: boolean; personaId?: string; mode?: AgentPurgeMode },
): PurgedSessionRecord | null {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return null
  const map = getPurgedSessions()
  if (map[key]) return map[key]
  if (!req?.enabled) return null
  if (sessionFileHasPriorTurns(sessionFile)) return null

  const cfg = getAgentPurgeConfig()
  const chosen =
    cfg.personas.find((p) => p.id === req.personaId) ??
    cfg.personas.find((p) => p.id === cfg.defaultPersonaId) ??
    cfg.personas[0]
  if (!chosen || !chosen.body.trim()) return null

  const record: PurgedSessionRecord = {
    personaId: chosen.id,
    personaName: chosen.name,
    mode: normalizePurgeMode(req.mode ?? cfg.defaultMode, cfg.defaultMode),
    body: chosen.body.trim(),
    lockedAt: Date.now(),
  }
  map[key] = record
  store().set('purgedSessions', map)
  return record
}

export function inheritPurgedSession(
  fromSessionFile: string | undefined,
  toSessionFile: string | undefined,
): void {
  const from = normalizePurgedSessionKey(fromSessionFile)
  const to = normalizePurgedSessionKey(toSessionFile)
  if (!from || !to || from === to) return
  const map = getPurgedSessions()
  if (!map[from] || map[to]) return
  map[to] = { ...map[from], lockedAt: Date.now() }
  store().set('purgedSessions', map)
}

export function removePurgedSession(sessionFile: string | undefined): void {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return
  const map = getPurgedSessions()
  if (!map[key]) return
  delete map[key]
  store().set('purgedSessions', map)
}

export function importPersonasFromDirectory(dirPath?: string): {
  imported: AgentPurgePersona[]
  config: AgentPurgeConfig
  dir: string
} {
  const dir = dirPath?.trim() ? resolve(dirPath.trim()) : resolveLocalAgentPurgePersonasDir()
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`目录不存在：${dir}`)
  }
  const files = readdirSync(dir).filter((f) => {
    if (extname(f).toLowerCase() !== '.md') return false
    if (f.startsWith('.')) return false
    return !IGNORED_MD_NAMES.has(f.toLowerCase())
  })

  const imported: AgentPurgePersona[] = []
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8')
    const fallbackId = basename(file, extname(file))
    const parsed = parsePersonaMarkdown(raw, fallbackId)
    if (parsed) imported.push({ ...parsed, updatedAt: Date.now() })
  }

  if (imported.length === 0) {
    return { imported: [], config: getAgentPurgeConfig(), dir }
  }

  const current = getAgentPurgeConfig()
  const byId = new Map(current.personas.map((p) => [p.id, p]))
  for (const p of imported) {
    const prev = byId.get(p.id)
    byId.set(p.id, {
      ...prev,
      ...p,
      ...(prev?.builtin ? { builtin: true, order: prev.order } : {}),
    })
  }
  const next = saveAgentPurgeConfig({ ...current, personas: [...byId.values()] })
  return { imported, config: next, dir }
}

function parseGithubSource(source: string): { owner: string; repo: string; ref?: string; subpath: string } {
  const raw = source.trim()
  if (!raw) throw new Error('请输入 GitHub 仓库地址或 owner/repo')
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const u = new URL(raw)
    if (!u.hostname.toLowerCase().includes('github.com')) {
      throw new Error('仅支持 GitHub 仓库地址')
    }
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) throw new Error('无效的 GitHub 仓库 URL')
    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      return { owner, repo, ref: parts[3], subpath: parts.slice(4).join('/') }
    }
    return { owner, repo, subpath: '' }
  }
  const clean = raw.replace(/\.git$/i, '')
  const [repoPart, ref] = clean.split('@')
  const parts = repoPart.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('格式示例：ZiChuanLan/some-magic')
  return {
    owner: parts[0],
    repo: parts[1],
    ...(ref ? { ref } : {}),
    subpath: parts.slice(2).join('/'),
  }
}

export async function importPersonasFromGithub(source: string): Promise<{
  imported: AgentPurgePersona[]
  config: AgentPurgeConfig
}> {
  const { owner, repo, ref, subpath } = parseGithubSource(source)
  const pathPart = subpath ? `/${subpath.split('/').map(encodeURIComponent).join('/')}` : ''
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${pathPart}${query}`

  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'pi-desktop' },
  })
  if (!res.ok) {
    throw new Error(`GitHub API 请求失败 (HTTP ${res.status})`)
  }
  const data = (await res.json()) as unknown
  const entries = Array.isArray(data) ? data : [data]
  const mdItems = entries.filter((e): e is { name: string; download_url?: string; type?: string } => {
    if (!e || typeof e !== 'object') return false
    const item = e as { name?: string; download_url?: string; type?: string }
    if (item.type !== 'file' || typeof item.name !== 'string' || !item.download_url) return false
    if (extname(item.name).toLowerCase() !== '.md') return false
    return !IGNORED_MD_NAMES.has(item.name.toLowerCase())
  })

  const imported: AgentPurgePersona[] = []
  for (const item of mdItems) {
    const rawRes = await fetch(item.download_url!, { headers: { 'User-Agent': 'pi-desktop' } })
    if (!rawRes.ok) continue
    const raw = await rawRes.text()
    const parsed = parsePersonaMarkdown(raw, basename(item.name, extname(item.name)))
    if (parsed) imported.push({ ...parsed, updatedAt: Date.now() })
  }

  if (imported.length === 0) {
    return { imported: [], config: getAgentPurgeConfig() }
  }

  const current = getAgentPurgeConfig()
  const byId = new Map(current.personas.map((p) => [p.id, p]))
  for (const p of imported) {
    const prev = byId.get(p.id)
    byId.set(p.id, {
      ...prev,
      ...p,
      ...(prev?.builtin ? { builtin: true, order: prev.order } : {}),
    })
  }
  const next = saveAgentPurgeConfig({ ...current, personas: [...byId.values()] })
  return { imported, config: next }
}
