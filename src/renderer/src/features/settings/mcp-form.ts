// MCP server config <-> the edit form of the MCP settings page. Keys the form does not show
// (oauth, auth, toolExposure, enabled, …) are kept from the original entry.

export type McpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden'
export const MCP_EXPOSURES: McpExposure[] = ['codemode', 'deferred', 'direct', 'hidden']

export interface McpForm {
  name: string
  kind: 'stdio' | 'http'
  command: string
  /** One argument per line. */
  args: string
  /** KEY=VALUE per line. */
  env: string
  cwd: string
  url: string
  /** `Name: value` per line. */
  headers: string
  description: string
  timeout: string
  exposure: McpExposure
}

type Config = Record<string, unknown>

const STDIO_KEYS = ['command', 'args', 'env', 'cwd']
const HTTP_KEYS = ['url', 'headers', 'oauth', 'auth']

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

function pairs(text: string, sep: '=' | ':'): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of lines(text)) {
    const at = line.indexOf(sep)
    if (at <= 0) continue
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

function joinPairs(v: unknown, sep: string): string {
  if (!v || typeof v !== 'object') return ''
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}${sep}${String(x)}`)
    .join('\n')
}

export function emptyForm(): McpForm {
  return { name: '', kind: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '', description: '', timeout: '', exposure: 'codemode' }
}

export function toForm(name: string, config: Config): McpForm {
  return {
    name,
    kind: typeof config.url === 'string' ? 'http' : 'stdio',
    command: str(config.command),
    args: Array.isArray(config.args) ? config.args.map(String).join('\n') : '',
    env: joinPairs(config.env, '='),
    cwd: str(config.cwd),
    url: str(config.url),
    headers: joinPairs(config.headers, ': '),
    description: str(config.description),
    timeout: typeof config.timeout === 'number' ? String(config.timeout) : '',
    exposure: MCP_EXPOSURES.includes(config.exposure as McpExposure) ? (config.exposure as McpExposure) : 'codemode',
  }
}

/** The config to save for `form`, on top of `base` (the entry being edited). */
export function fromForm(form: McpForm, base: Config = {}): Config {
  const out: Config = { ...base }
  for (const key of form.kind === 'stdio' ? HTTP_KEYS : STDIO_KEYS) delete out[key]
  delete out.type
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === '') delete out[key]
    else out[key] = value
  }
  if (form.kind === 'stdio') {
    set('command', form.command.trim())
    const args = lines(form.args)
    set('args', args.length ? args : undefined)
    set('env', pairs(form.env, '='))
    set('cwd', form.cwd.trim())
  } else {
    set('url', form.url.trim())
    set('headers', pairs(form.headers, ':'))
  }
  set('description', form.description.trim())
  const timeout = Number(form.timeout)
  set('timeout', form.timeout.trim() && Number.isFinite(timeout) && timeout > 0 ? timeout : undefined)
  set('exposure', form.exposure === 'codemode' ? undefined : form.exposure)
  return out
}

/** Short transport line for the server list: the URL host+path or the command line. */
export function describeTransport(config: Config): string {
  if (typeof config.url === 'string') {
    try {
      const u = new URL(config.url)
      return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
    } catch {
      return config.url
    }
  }
  const args = Array.isArray(config.args) ? config.args.map(String) : []
  return [str(config.command), ...args].join(' ').trim()
}
