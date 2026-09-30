import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { wslPathToWindows, wslWindowsPathDistro } from '@shared/wsl-path'
import { net, shell } from 'electron'
import { getActiveAgentDir, getActiveHomeDir, getActiveDesktopDir } from './active-dirs'
import { configStore } from '../main/config-store'
import { findAdapterById, prepareAdapterCatalog } from './adapter-loader'
import type { AdapterConfig, AdapterJson, ConfigField } from './adapter-schema'
import { extractJsonPath } from './json-path'
import { resolveWslEnv } from '../main/wsl/wsl-env'
import { runWslAsync } from '../main/wsl/wsl-exec'

const writes = new Map<string, Promise<unknown>>()

function serialize<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = writes.get(path) ?? Promise.resolve()
  const job = previous.catch(() => {}).then(work)
  writes.set(path, job)
  void job.finally(() => { if (writes.get(path) === job) writes.delete(path) }).catch(() => {})
  return job
}

function expandPath(path: string, workspaceId: string, home: string): string {
  if (path === '~') return home
  if (/^~[/\\]/.test(path)) return join(home, path.slice(2))
  const distro = wslWindowsPathDistro(home)
  if (distro && path.startsWith('/')) return wslPathToWindows(distro, path)
  return isAbsolute(path) ? path : resolve(workspaceId || process.cwd(), path)
}

async function readSharedFile(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  try {
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid shape')
    return data as Record<string, unknown>
  } catch {
    throw new Error('adapter config file is invalid JSON; repair the file before saving')
  }
}

async function atomicWrite(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    await copyFile(path, `${path}.bak`).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}

const environments = new Map<string, { at: number; promise: Promise<NodeJS.ProcessEnv> }>()

async function configEnvironment(home: string, config: AdapterConfig): Promise<NodeJS.ProcessEnv> {
  const distro = wslWindowsPathDistro(home)
  const names = [...new Set(Object.values(config.envOverride ?? {}))].sort()
  if (!distro) return { ...process.env }
  if (!names.length) return {}
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('invalid environment variable name')
  const env = await resolveWslEnv(distro)
  if (!env) throw new Error('WSL environment unavailable')
  const key = `${distro}|${env.resolvedAt}|${names.join(',')}`
  const cached = environments.get(key)
  if (cached && Date.now() - cached.at < 30000) return cached.promise
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const script = `printf '\\n__PI_ADAPTER_ENV__\\n'; ${names.map((name) => `if [ "\${${name}+x}" ]; then printf '${name}=%s\\0' "$${name}"; fi`).join('; ')}; printf '__PI_ADAPTER_END__'`
  const promise = runWslAsync(['-d', distro, '--', 'sh', '-s'], { input: `exec ${quote(env.shell)} -ilc ${quote(script)}\n`, timeout: 15000, maxBuffer: 1024 * 1024 }).then((result) => {
    const marker = '\n__PI_ADAPTER_ENV__\n'
    const start = result.stdout.indexOf(marker), end = result.stdout.indexOf('__PI_ADAPTER_END__', start)
    if (result.status !== 0 || start < 0 || end < 0) throw new Error('cannot read WSL configuration environment')
    return Object.fromEntries(result.stdout.slice(start + marker.length, end).split('\0').filter(Boolean).map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
  }).catch((error) => { environments.delete(key); throw error })
  environments.set(key, { at: Date.now(), promise })
  return promise
}

type Context = { adapter: AdapterJson; config: AdapterConfig; file?: string; workspaceId: string; home: string; env: NodeJS.ProcessEnv; localScope: string }

async function context(adapterId: string, workspaceId: string): Promise<Context> {
  const home = getActiveHomeDir()
  const agentDir = getActiveAgentDir()
  const expectedScope = getActiveDesktopDir()
  await prepareAdapterCatalog(workspaceId)
  if (getActiveDesktopDir() !== expectedScope) throw new Error('adapter runtime changed; retry the request')
  const adapter = findAdapterById(adapterId, workspaceId)
  if (!adapter) throw new Error(`unknown adapter: ${adapterId}`)
  const config = adapter.config ?? {}
  const file = config.piSettingsKey ? join(agentDir, 'settings.json') : config.configFile ? expandPath(config.configFile, workspaceId, home) : undefined
  return { adapter, config, file, workspaceId, home, env: await configEnvironment(home, config), localScope: `${agentDir}|${workspaceId}` }
}

function localConfig(ctx: Context): Record<string, unknown> {
  return configStore.getExtensionConfig(ctx.localScope, ctx.adapter.id)
    ?? configStore.getExtensionConfig(ctx.workspaceId, ctx.adapter.id)
    ?? {}
}

async function rawView(ctx: Context): Promise<Record<string, unknown>> {
  const cfg = ctx.config
  const local = localConfig(ctx)
  if (!ctx.file) return { ...local }
  const file = await readSharedFile(ctx.file)
  if (cfg.piSettingsKey) return { [cfg.piSettingsKey]: file[cfg.piSettingsKey] }
  const fields = (cfg.sections ?? []).flatMap((section) => section.fields ?? [])
  const view: Record<string, unknown> = {}
  for (const field of fields) view[field.key] = field.default ?? ''
  for (const [key, fileKey] of Object.entries(cfg.fileKeyMap ?? {})) {
    view[key] = (cfg.envOverride?.[key] ? ctx.env[cfg.envOverride[key]] : undefined) ?? file[fileKey] ?? view[key]
  }
  for (const key of cfg.localKeys ?? []) view[key] = local[key] ?? view[key]
  return view
}

async function renderView(ctx: Context): Promise<Record<string, unknown>> {
  let view: Record<string, unknown>
  try {
    view = await rawView(ctx)
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid JSON')) return { __configFile: ctx.config.configFile, __configFileError: 'invalid_json' }
    throw error
  }
  for (const field of (ctx.config.sections ?? []).flatMap((section) => section.fields ?? [])) {
    if (field.type !== 'secret') continue
    const set = !!view[field.key]
    view[field.key] = set ? '••••••••' : ''
    view[`${field.key}Set`] = set
  }
  if (ctx.config.configFile) view.__configFile = ctx.config.configFile
  if (ctx.config.piSettingsKey) view.__piSettings = true
  return view
}

export async function readAdapterConfig(adapterId: string, workspaceId: string): Promise<Record<string, unknown>> {
  return renderView(await context(adapterId, workspaceId))
}

export async function readRawView(adapterId: string, workspaceId = ''): Promise<Record<string, unknown>> {
  return rawView(await context(adapterId, workspaceId))
}

function checkedPatch(cfg: AdapterConfig, patch: Record<string, unknown>): Record<string, unknown> {
  const fields = new Map<string, ConfigField>((cfg.sections ?? []).flatMap((section) => section.fields ?? []).map((field) => [field.key, field]))
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const field = fields.get(key)
    if (!field || field.readOnly || value === undefined) continue
    if (field.type === 'secret' && (value === '' || String(value).includes('•') || String(value).includes('…'))) continue
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`invalid number: ${key}`)
    if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`invalid boolean: ${key}`)
    if (['text', 'secret', 'select'].includes(field.type) && typeof value !== 'string') throw new Error(`invalid text: ${key}`)
    output[key] = value
  }
  return output
}

export async function writeAdapterConfig(adapterId: string, workspaceId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctx = await context(adapterId, workspaceId)
  const updates = checkedPatch(ctx.config, patch)
  await serialize(ctx.file ?? `${ctx.localScope}:${adapterId}`, async () => {
    if (getActiveAgentDir() !== ctx.localScope.split('|')[0]) throw new Error('adapter runtime changed; retry the request')
    const local = { ...localConfig(ctx) }
    if (ctx.file) {
      const file = await readSharedFile(ctx.file)
      for (const [key, value] of Object.entries(updates)) {
        if (ctx.config.localKeys?.includes(key)) local[key] = value
        else if (ctx.config.piSettingsKey === key) file[key] = value
        else if (ctx.config.fileKeyMap?.[key]) file[ctx.config.fileKeyMap[key]] = value
      }
      await atomicWrite(ctx.file, file)
    } else Object.assign(local, updates)
    if (!ctx.file || ctx.config.localKeys?.some((key) => key in updates)) configStore.setExtensionConfig(ctx.localScope, adapterId, local)
  })
  return renderView(ctx)
}

function template(text: string, view: Record<string, unknown>): string {
  return text.replace(/\$\{(\w+)(?:\?([^:}]*):([^}]*))?\}/g, (_match, key: string, yes?: string, no?: string) => yes !== undefined ? (view[key] ? yes : no ?? '') : String(view[key] ?? ''))
}

function headersFrom(values: Record<string, string> | undefined, view: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, template(value, view)]))
}

export async function runAdapterAction(adapterId: string, actionId: string, workspaceId = ''): Promise<{ ok: boolean; lines?: string[]; error?: string }> {
  try {
    const ctx = await context(adapterId, workspaceId)
    const action = ctx.config.actions?.find((item) => item.id === actionId)
    if (!action) return { ok: false, error: 'action not found' }
    if (action.type === 'reload') {
      const { workerManager } = await import('../main/worker-manager')
      await prepareAdapterCatalog(workspaceId, { refresh: true })
      await workerManager.reloadResources(workspaceId)
      return { ok: true, lines: ['reloaded'] }
    }
    const view = await rawView(ctx)
    if (action.type === 'openPath') {
      const target = template(action.url ?? '', view)
      if (!target) return { ok: false, error: 'no path' }
      const error = await shell.openPath(expandPath(target, workspaceId, ctx.home))
      return error ? { ok: false, error } : { ok: true }
    }
    const method = (action.method ?? 'GET').toUpperCase()
    const response = await net.fetch(template(action.url ?? '', view), { method, headers: headersFrom(action.headers, view), body: action.body === undefined ? undefined : JSON.stringify(action.body), signal: AbortSignal.timeout(action.timeoutMs ?? 15000) })
    let detail = ''
    if (response.ok && action.report?.countPath) detail = ` ${action.report.label ?? 'count'}: ${extractJsonPath(await response.json(), action.report.countPath)}`
    return { ok: response.ok, lines: [`${method} HTTP ${response.status}${detail}`] }
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message === 'SESSION_BUSY' ? 'SESSION_BUSY' : 'adapter action failed; check configuration and connection' }
  }
}

export async function fetchFieldOptions(adapterId: string, fieldKey: string, workspaceId = ''): Promise<{ options: string[]; error?: string }> {
  try {
    const ctx = await context(adapterId, workspaceId)
    const field = (ctx.config.sections ?? []).flatMap((section) => section.fields ?? []).find((item) => item.key === fieldKey)
    const source = field?.optionsFrom
    if (!source) return { options: [], error: 'field has no optionsFrom' }
    const view = await rawView(ctx)
    const response = await net.fetch(template(source.url, view), { headers: headersFrom(source.headers, view), signal: AbortSignal.timeout(source.timeoutMs ?? 15000) })
    if (!response.ok) return { options: [], error: `HTTP ${response.status}` }
    const items = extractJsonPath(await response.json(), source.itemsPath)
    if (!Array.isArray(items)) return { options: [], error: 'itemsPath not an array' }
    // Labels never replace the stored id.
    return { options: items.map((item: unknown) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>)[source.valueFrom ?? 'id'] ?? '') : '').filter(Boolean) }
  } catch {
    return { options: [], error: 'cannot read adapter options' }
  }
}
