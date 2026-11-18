import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  defaultAgentPurgePersonas,
  normalizeAgentPurgeConfig,
  normalizePurgeMode,
  normalizePurgedSessionKey,
  normalizePurgedSessionsMap,
  normalizePurgeStrategy,
  parsePersonaMarkdown,
  personaCopy,
  personaLanguage,
  type ActivePurgePayload,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
  type PurgedSessionRecord,
  type PurgeStrategyOptions,
} from '@shared/agent-purge'
import { mainLabel } from '@shared/main-labels'
import { getMainUiLanguage } from '@shared/main-language'
import { configStore } from './config-store'

function store(): typeof configStore | null {
  return configStore
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
  return normalizeAgentPurgeConfig(store()?.get('agentPurgeConfig'))
}

export function saveAgentPurgeConfig(raw: unknown): AgentPurgeConfig {
  const normalized = normalizeAgentPurgeConfig(raw)
  store()?.set('agentPurgeConfig', normalized)
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
  const s = store()
  if (typeof s?.get !== 'function') return {}
  return normalizePurgedSessionsMap(s.get('purgedSessions'))
}

export function getActivePurgeForSession(sessionFile: string | null | undefined): ActivePurgePayload | null {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return null
  const record = getPurgedSessions()[key]
  if (!record || !record.body.trim()) return null
  const cfg = getAgentPurgeConfig()
  const livePersona = cfg.personas.find((p) => p.id === record.personaId)
  const copy = livePersona ? personaCopy(livePersona, personaLanguage(getMainUiLanguage())) : null
  const primerTurns = record.primerTurns ?? copy?.primerTurns
  return {
    personaId: record.personaId,
    personaName: record.personaName,
    mode: record.mode,
    body: record.body,
    ...(primerTurns ? { primerTurns } : {}),
    strategy: record.strategy,
    ...(cfg.retryFallbackModel ? { retryFallbackModel: cfg.retryFallbackModel } : {}),
    ...(cfg.customTerms.length > 0 ? { customTerms: cfg.customTerms } : {}),
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
  req?: {
    enabled?: boolean
    personaId?: string
    mode?: AgentPurgeMode
    strategy?: Partial<PurgeStrategyOptions>
  },
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
  if (!chosen) return null
  const copy = personaCopy(chosen, personaLanguage(getMainUiLanguage()))
  const body = copy.body.trim()
  if (!body) return null

  const record: PurgedSessionRecord = {
    personaId: chosen.id,
    personaName: copy.name,
    mode: normalizePurgeMode(req.mode ?? cfg.defaultMode, cfg.defaultMode),
    body,
    ...(copy.primerTurns ? { primerTurns: copy.primerTurns } : {}),
    strategy: normalizePurgeStrategy(req.strategy, cfg.defaultStrategy),
    lockedAt: Date.now(),
  }
  map[key] = record
  store()?.set('purgedSessions', map)
  return record
}

export function inheritPurgedSession(
  fromSessionFile: string | undefined,
  toSessionFile: string | undefined,
): void {
  const from = normalizePurgedSessionKey(fromSessionFile)
  const to = normalizePurgedSessionKey(toSessionFile)
  if (!from || !to || from === to) return
  const s = store()
  if (typeof s?.get !== 'function' || typeof s?.set !== 'function') return
  const map = getPurgedSessions()
  if (!map[from] || map[to]) return
  map[to] = {
    ...map[from],
    strategy: { ...map[from].strategy },
    lockedAt: Date.now(),
  }
  s.set('purgedSessions', map)
}

export function setPurgedSession(
  sessionFile: string | undefined,
  req: {
    enabled: boolean
    personaId?: string
    mode?: AgentPurgeMode
    strategy?: Partial<PurgeStrategyOptions>
  },
): PurgedSessionRecord | null {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return null
  if (!req.enabled) {
    removePurgedSession(sessionFile)
    return null
  }
  const cfg = getAgentPurgeConfig()
  const map = getPurgedSessions()
  const existing = map[key]
  const chosen =
    cfg.personas.find((p) => p.id === (req.personaId ?? existing?.personaId)) ??
    cfg.personas.find((p) => p.id === cfg.defaultPersonaId) ??
    cfg.personas[0]
  if (!chosen) return null
  const copy = personaCopy(chosen, personaLanguage(getMainUiLanguage()))
  const body = copy.body.trim()
  if (!body) return null

  const baseStrategy = existing?.strategy ?? cfg.defaultStrategy
  const nextStrategy = req.strategy
    ? normalizePurgeStrategy({ ...baseStrategy, ...req.strategy }, baseStrategy)
    : normalizePurgeStrategy(baseStrategy, cfg.defaultStrategy)

  const record: PurgedSessionRecord = {
    personaId: chosen.id,
    personaName: copy.name,
    mode: normalizePurgeMode(req.mode ?? existing?.mode ?? cfg.defaultMode, cfg.defaultMode),
    body,
    ...(copy.primerTurns ? { primerTurns: copy.primerTurns } : {}),
    strategy: nextStrategy,
    lockedAt: existing?.lockedAt || Date.now(),
  }
  map[key] = record
  store()?.set('purgedSessions', map)
  return record
}

export function removePurgedSession(sessionFile: string | undefined): void {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return
  const s = store()
  if (typeof s?.get !== 'function' || typeof s?.set !== 'function') return
  const map = getPurgedSessions()
  if (!map[key]) return
  delete map[key]
  s.set('purgedSessions', map)
}

export function importPersonasFromDirectory(dirPath?: string): {
  imported: AgentPurgePersona[]
  config: AgentPurgeConfig
  dir: string
} {
  const dir = dirPath?.trim() ? resolve(dirPath.trim()) : resolveLocalAgentPurgePersonasDir()
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(mainLabel(getMainUiLanguage(), 'purge.dirMissing', { dir }))
  }

  const current = getAgentPurgeConfig()
  const byId = new Map(current.personas.map((p) => [p.id, p]))
  const imported: AgentPurgePersona[] = []

  const files = readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === '.md' && !IGNORED_MD_NAMES.has(f.toLowerCase()))
    .sort()

  for (const file of files) {
    const full = join(dir, file)
    let raw = ''
    try {
      if (!statSync(full).isFile()) continue
      raw = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const stem = basename(file, extname(file))
    const parsed = parsePersonaMarkdown(raw, stem)
    if (!parsed) continue
    const existing = byId.get(parsed.id)
    const merged: AgentPurgePersona = {
      ...parsed,
      ...(existing?.builtin ? { builtin: true, order: existing.order } : {}),
      updatedAt: Date.now(),
    }
    byId.set(merged.id, merged)
    imported.push(merged)
  }

  const saved = saveAgentPurgeConfig({
    ...current,
    personas: [...byId.values()],
  })
  return { imported, config: saved, dir }
}

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com'
const GITHUB_API_BASE = 'https://api.github.com'

function parseGithubSource(source: string): { owner: string; repo: string; branch?: string; path?: string } {
  const trimmed = source.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const urlMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?$/i.exec(trimmed)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      branch: urlMatch[3] || undefined,
      path: urlMatch[4] || undefined,
    }
  }
  const shortMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/]+))?(?:\/(.*))?$/.exec(trimmed)
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      branch: shortMatch[3] || undefined,
      path: shortMatch[4] || undefined,
    }
  }
  throw new Error(mainLabel(getMainUiLanguage(), 'purge.invalidGithubSource'))
}

export async function importPersonasFromGithub(source: string): Promise<{
  imported: AgentPurgePersona[]
  config: AgentPurgeConfig
}> {
  const { owner, repo, branch, path: subPath } = parseGithubSource(source)
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pi-desktop',
  }

  let ref = branch
  if (!ref) {
    const repoResp = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers })
    if (!repoResp.ok) {
      throw new Error(`GitHub HTTP ${repoResp.status}`)
    }
    const repoJson = (await repoResp.json()) as { default_branch?: string }
    ref = repoJson.default_branch || 'main'
  }

  const treeResp = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers },
  )
  if (!treeResp.ok) {
    throw new Error(`GitHub tree HTTP ${treeResp.status}`)
  }
  const treeJson = (await treeResp.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>
  }

  const prefix = subPath ? `${subPath.replace(/^\/+|\/+$/g, '')}/` : ''
  const mdEntries = (treeJson.tree ?? []).filter((entry) => {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') return false
    if (prefix && !entry.path.startsWith(prefix)) return false
    if (!entry.path.toLowerCase().endsWith('.md')) return false
    if ((entry.size ?? 0) > 512 * 1024) return false
    const base = basename(entry.path).toLowerCase()
    return !IGNORED_MD_NAMES.has(base)
  })

  const current = getAgentPurgeConfig()
  const byId = new Map(current.personas.map((p) => [p.id, p]))
  const imported: AgentPurgePersona[] = []

  for (const entry of mdEntries.slice(0, 40)) {
    const relPath = entry.path!
    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${encodeURIComponent(ref)}/${relPath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    try {
      const r = await fetch(rawUrl, { headers: { 'User-Agent': 'pi-desktop' } })
      if (!r.ok) continue
      const text = await r.text()
      const stem = basename(relPath, extname(relPath))
      const parsed = parsePersonaMarkdown(text, stem)
      if (!parsed) continue
      const existing = byId.get(parsed.id)
      const merged: AgentPurgePersona = {
        ...parsed,
        ...(existing?.builtin ? { builtin: true, order: existing.order } : {}),
        updatedAt: Date.now(),
      }
      byId.set(merged.id, merged)
      imported.push(merged)
    } catch {
      /* skip broken file */
    }
  }

  const saved = saveAgentPurgeConfig({
    ...current,
    personas: [...byId.values()],
  })
  return { imported, config: saved }
}
