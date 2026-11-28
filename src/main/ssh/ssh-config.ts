import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SshHostStoredEntry {
  host: string
  label?: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  remotePath?: string
}

export interface SshHostItem extends SshHostStoredEntry {
  source: 'config' | 'custom' | 'both'
  enabled: boolean
}

interface SshPersistence {
  readHosts(): SshHostStoredEntry[] | undefined
  writeHosts(hosts: SshHostStoredEntry[]): void
  activeHost(): string | null
}

let persistence: SshPersistence | null = null

export function bindSshPersistence(backing: SshPersistence | null): void {
  persistence = backing
}

const SSH_COMPONENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/
const SSH_HOST_PATTERN = /^(?:[A-Za-z0-9._][A-Za-z0-9._-]*@)?[A-Za-z0-9._][A-Za-z0-9._-]*$/

export function isValidSshHost(host: string | null | undefined): boolean {
  return typeof host === 'string' && SSH_HOST_PATTERN.test(host.trim())
}

export function assertSshConnectionOptions(entry: SshHostStoredEntry): void {
  if (entry.hostName && !SSH_COMPONENT.test(entry.hostName) && (!isIP(entry.hostName) || entry.hostName.includes('%'))) {
    throw new Error('Invalid SSH hostname')
  }
  if (entry.user && !SSH_COMPONENT.test(entry.user)) throw new Error('Invalid SSH user')
  if (entry.port !== undefined && (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535)) {
    throw new Error('Invalid SSH port')
  }
  if (entry.identityFile && /[\r\n\0]/.test(entry.identityFile)) throw new Error('Invalid SSH identity path')
}

function stripQuotes(val: string): string {
  const trimmed = val.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function applyConfigKey(entry: SshHostStoredEntry, key: string, rawVal: string): void {
  const val = stripQuotes(rawVal)
  if (!val) return
  if (key === 'hostname') entry.hostName = val
  else if (key === 'user') entry.user = val
  else if (key === 'port') {
    const n = Number(val)
    if (Number.isInteger(n) && n >= 1 && n <= 65535) entry.port = n
  } else if (key === 'identityfile' && !entry.identityFile) {
    entry.identityFile = val
  }
}

/** Parse concrete Host blocks from OpenSSH config content (ignores wildcard patterns like `*`). */
export function parseSshConfigText(content: string): SshHostStoredEntry[] {
  const byHost = new Map<string, SshHostStoredEntry>()
  let activeAliases: string[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const match = /^([A-Za-z0-9]+)\s*(?:=|\s)\s*(.+)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const val = match[2].trim()
    if (key === 'host') {
      activeAliases = val
        .split(/\s+/)
        .map(stripQuotes)
        .filter((alias) => alias && !/[*?!]/.test(alias) && isValidSshHost(alias))
      for (const alias of activeAliases) {
        if (!byHost.has(alias)) byHost.set(alias, { host: alias })
      }
      continue
    }
    if (key === 'match') {
      activeAliases = []
      continue
    }
    for (const alias of activeAliases) {
      const target = byHost.get(alias)
      if (target) applyConfigKey(target, key, val)
    }
  }
  return [...byHost.values()]
}

export function readUserSshConfigHosts(sshConfigPath = join(homedir(), '.ssh', 'config')): SshHostStoredEntry[] {
  try {
    const raw = readFileSync(sshConfigPath, 'utf8')
    return parseSshConfigText(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function getStoredSshHosts(): SshHostStoredEntry[] {
  const raw = persistence?.readHosts()
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is SshHostStoredEntry => !!item && isValidSshHost(item.host))
}

export function listSshHosts(): SshHostItem[] {
  const fromConfig = readUserSshConfigHosts()
  const stored = getStoredSshHosts()
  const activeHost = persistence?.activeHost()

  const map = new Map<string, SshHostItem>()
  for (const c of fromConfig) {
    map.set(c.host, {
      ...c,
      source: 'config',
      enabled: activeHost === c.host,
    })
  }
  for (const s of stored) {
    const prev = map.get(s.host)
    map.set(s.host, {
      ...(prev ?? {}),
      ...s,
      hostName: s.hostName || prev?.hostName,
      user: s.user || prev?.user,
      port: s.port || prev?.port,
      identityFile: s.identityFile || prev?.identityFile,
      remotePath: s.remotePath || prev?.remotePath,
      source: prev ? 'both' : 'custom',
      enabled: activeHost === s.host,
    })
  }
  if (activeHost && !map.has(activeHost)) {
    map.set(activeHost, { host: activeHost, source: 'custom', enabled: true })
  }
  return [...map.values()]
}

export function findSshHostEntry(host: string): SshHostItem | null {
  const clean = host.trim().replace(/^ssh@/i, '')
  return listSshHosts().find((h) => h.host === clean) ?? (isValidSshHost(clean) ? { host: clean, source: 'custom', enabled: false } : null)
}

export function saveSshHostEntry(entry: SshHostStoredEntry): SshHostItem[] {
  const host = entry.host.trim().replace(/^ssh@/i, '')
  if (!isValidSshHost(host)) throw new Error('Invalid SSH host')
  const current = getStoredSshHosts()
  const idx = current.findIndex((h) => h.host === host)
  const normalized: SshHostStoredEntry = {
    ...(idx >= 0 ? current[idx] : {}),
    host,
    ...(entry.label !== undefined ? { label: entry.label.trim() || undefined } : {}),
    ...(entry.hostName !== undefined ? { hostName: entry.hostName.trim() || undefined } : {}),
    ...(entry.user !== undefined ? { user: entry.user.trim() || undefined } : {}),
    ...(entry.port !== undefined ? { port: entry.port || undefined } : {}),
    ...(entry.identityFile !== undefined ? { identityFile: entry.identityFile.trim() || undefined } : {}),
    ...(entry.remotePath !== undefined ? { remotePath: entry.remotePath.trim() || undefined } : {}),
  }
  assertSshConnectionOptions(normalized)
  const next = idx >= 0 ? current.map((item, i) => (i === idx ? normalized : item)) : [...current, normalized]
  writeHosts(next)
  return listSshHosts()
}

export function removeSshHostEntry(host: string): SshHostItem[] {
  const clean = host.trim().replace(/^ssh@/i, '')
  const next = getStoredSshHosts().filter((h) => h.host !== clean)
  writeHosts(next)
  return listSshHosts()
}

function writeHosts(hosts: SshHostStoredEntry[]): void {
  if (!persistence) throw new Error('SSH host settings are unavailable')
  persistence.writeHosts(hosts)
}
