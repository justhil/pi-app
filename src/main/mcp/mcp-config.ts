// mcp.json editing for the MCP settings page. Same files and rules as pi's built-in MCP support:
// global servers in <agentDir>/mcp.json, project servers and overrides in <project>/.pi/mcp.json.
// Edits keep every key the page does not touch, and write with two-space indentation.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type McpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden'
export const MCP_EXPOSURES: readonly McpExposure[] = ['codemode', 'deferred', 'direct', 'hidden']

export type McpServerConfig = Record<string, unknown>

export interface McpServerRow {
  name: string
  scope: 'global' | 'project'
  /** The effective config (a project override merged over the global entry). */
  config: McpServerConfig
  /** Project file holding an override of this global server's enabled / exposure / toolExposure. */
  override?: McpServerConfig
  source: string
}

export interface McpConfigView {
  globalPath: string
  projectPath: string | null
  servers: McpServerRow[]
  autoEnableCodemode: boolean
  errors: string[]
}

const NAME = /^[A-Za-z0-9_-]+$/
const OVERRIDE_KEYS = ['enabled', 'exposure', 'toolExposure'] as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** An entry without command/url/type only overrides a global server of the same name. */
export const isOverrideEntry = (c: unknown) => isObj(c) && c.command === undefined && c.url === undefined && c.type === undefined

export function globalMcpPath(agentDir: string): string {
  return join(agentDir, 'mcp.json')
}
export function projectMcpPath(project: string): string {
  return join(project, '.pi', 'mcp.json')
}

type FileState = { data: Record<string, unknown>; error?: string }

function readFile(path: string): FileState {
  if (!existsSync(path)) return { data: {} }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isObj(data)) return { data: {}, error: `${path}: expected a JSON object` }
    return { data }
  } catch (e) {
    return { data: {}, error: `${path}: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function writeFile(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, path)
}

function servers(data: Record<string, unknown>): Record<string, McpServerConfig> {
  return isObj(data.mcpServers) ? (data.mcpServers as Record<string, McpServerConfig>) : {}
}

export function readMcpConfig(opts: { agentDir: string; project?: string | null; projectTrusted: boolean }): McpConfigView {
  const globalPath = globalMcpPath(opts.agentDir)
  const projectPath = opts.project ? projectMcpPath(opts.project) : null
  const g = readFile(globalPath)
  const p = projectPath && opts.projectTrusted ? readFile(projectPath) : { data: {} }
  const errors = [g.error, p.error].filter((e): e is string => !!e)
  const rows = new Map<string, McpServerRow>()
  for (const [name, config] of Object.entries(servers(g.data))) {
    if (isObj(config)) rows.set(name, { name, scope: 'global', config, source: globalPath })
  }
  for (const [name, config] of Object.entries(servers(p.data))) {
    if (!isObj(config)) continue
    const global = rows.get(name)
    if (global && isOverrideEntry(config)) {
      rows.set(name, { ...global, config: { ...global.config, ...config }, override: config })
    } else if (!isOverrideEntry(config)) {
      rows.set(name, { name, scope: 'project', config, source: projectPath! })
    }
  }
  const auto = isObj(p.data) && typeof p.data.autoEnableCodemode === 'boolean' ? p.data.autoEnableCodemode : g.data.autoEnableCodemode
  return { globalPath, projectPath, servers: [...rows.values()], autoEnableCodemode: auto !== false, errors }
}

/** Problems with a server config the page is about to save; empty when it is fine. */
export function checkServer(name: string, config: McpServerConfig): string[] {
  const problems: string[] = []
  if (!NAME.test(name)) problems.push('name: letters, digits, _ and - only')
  const hasCommand = typeof config.command === 'string' && config.command.trim() !== ''
  const hasUrl = typeof config.url === 'string' && config.url.trim() !== ''
  if (hasCommand === hasUrl) problems.push('needs either command or url')
  if (hasUrl && !/^https?:\/\//i.test(String(config.url))) problems.push('url: must start with http:// or https://')
  if (config.type === 'sse') problems.push('type: sse is not supported, use streamable HTTP')
  if (config.args !== undefined && !(Array.isArray(config.args) && config.args.every((a) => typeof a === 'string'))) problems.push('args: list of strings')
  for (const key of ['env', 'headers'] as const) {
    const v = config[key]
    if (v !== undefined && !(isObj(v) && Object.values(v).every((x) => typeof x === 'string'))) problems.push(`${key}: string values only`)
  }
  if (config.exposure !== undefined && !MCP_EXPOSURES.includes(config.exposure as McpExposure)) problems.push('exposure: unknown value')
  if (config.timeout !== undefined && !(typeof config.timeout === 'number' && config.timeout > 0)) problems.push('timeout: positive seconds')
  return problems
}

/** Add or replace a server; `previousName` renames it. */
export function saveServer(path: string, name: string, config: McpServerConfig, previousName?: string): void {
  const problems = checkServer(name, config)
  if (problems.length) throw new Error(problems.join('; '))
  const { data, error } = readFile(path)
  if (error) throw new Error(error)
  const entries = { ...servers(data) }
  if (previousName && previousName !== name) delete entries[previousName]
  entries[name] = config
  writeFile(path, { ...data, mcpServers: entries })
}

export function removeServer(path: string, name: string): boolean {
  const { data, error } = readFile(path)
  if (error) throw new Error(error)
  const entries = { ...servers(data) }
  if (!(name in entries)) return false
  delete entries[name]
  writeFile(path, { ...data, mcpServers: entries })
  return true
}

/**
 * Change enabled / exposure of a server where it is defined, or — with `projectPath` for a global
 * server — as a project override. Defaults (enabled, codemode) are dropped from definitions but kept
 * in overrides, since an override replaces the global value. An override left empty is removed.
 */
export function patchServer(
  path: string,
  name: string,
  patch: { enabled?: boolean; exposure?: McpExposure | null },
  opts: { override?: boolean } = {},
): void {
  const { data, error } = readFile(path)
  if (error) throw new Error(error)
  const entries = { ...servers(data) }
  const current = isObj(entries[name]) ? { ...entries[name] } : opts.override ? {} : null
  if (!current) throw new Error(`${name} is not defined in ${path}`)
  if ('enabled' in patch) {
    if (patch.enabled === undefined || (!opts.override && patch.enabled)) delete current.enabled
    else current.enabled = patch.enabled
  }
  if ('exposure' in patch) {
    if (!patch.exposure || (!opts.override && patch.exposure === 'codemode')) delete current.exposure
    else current.exposure = patch.exposure
  }
  if (opts.override && OVERRIDE_KEYS.every((k) => current[k] === undefined) && isOverrideEntry(current)) delete entries[name]
  else entries[name] = current
  writeFile(path, { ...data, mcpServers: entries })
}

export function setAutoEnableCodemode(path: string, value: boolean): void {
  const { data, error } = readFile(path)
  if (error) throw new Error(error)
  const next = { ...data }
  if (value) delete next.autoEnableCodemode
  else next.autoEnableCodemode = false
  writeFile(path, next)
}

/**
 * Servers pasted from another client: `{ "mcpServers": {...} }`, a bare `{ name: config }` map, or
 * VS Code's `{ "servers": {...} }`. Returns the valid entries and the problems of the rest.
 */
export function parseImport(text: string): { servers: Record<string, McpServerConfig>; problems: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { servers: {}, problems: [e instanceof Error ? e.message : String(e)] }
  }
  const map = isObj(raw) ? (isObj(raw.mcpServers) ? raw.mcpServers : isObj(raw.servers) ? raw.servers : raw) : {}
  const out: Record<string, McpServerConfig> = {}
  const problems: string[] = []
  for (const [name, value] of Object.entries(map)) {
    if (!isObj(value)) {
      problems.push(`${name}: not an object`)
      continue
    }
    const config: McpServerConfig = { ...value }
    if (config.type === 'http' || config.type === 'streamable-http' || config.type === 'stdio') delete config.type
    const p = checkServer(name, config)
    if (p.length) problems.push(`${name}: ${p.join('; ')}`)
    else out[name] = config
  }
  return { servers: out, problems }
}
