// Runs `pi mcp <list|login|logout>` from the active SDK so the settings page sees exactly what pi
// sees: connection state, tools and errors, and the same OAuth credential store as sessions.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface McpServerStatus {
  name: string
  scope: string
  enabled: boolean
  exposure: string
  transport?: string
  state: string
  tools: string[]
  toolExposure?: Record<string, string>
  resources?: number
  error?: string
}

export interface McpStatusReport {
  servers: McpServerStatus[]
  errors: string[]
  note?: string
}

export interface McpCliEnv {
  sdkRoot: string
  agentDir: string
  cwd: string
}

export function mcpCliPath(sdkRoot: string): string | null {
  const cli = join(sdkRoot, 'dist', 'cli.js')
  return existsSync(cli) ? cli : null
}

export function runMcpCli(
  args: string[],
  env: McpCliEnv,
  opts: { timeoutMs?: number; onLine?: (line: string) => void } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cli = mcpCliPath(env.sdkRoot)
  if (!cli) return Promise.reject(new Error('MCP_CLI_UNAVAILABLE'))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'mcp', ...args], {
      cwd: env.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_CODING_AGENT_DIR: env.agentDir, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000)
    const forward = (chunk: string) => {
      if (!opts.onLine) return
      for (const line of chunk.split(/\r?\n/)) if (line.trim()) opts.onLine(line)
    }
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      stdout += c
      forward(c)
    })
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      stderr += c
      forward(c)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

/** The JSON object printed by `pi mcp list --json` (exit code 1 only means something is not connected). */
export function parseStatus(stdout: string): McpStatusReport {
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error('MCP_STATUS_UNREADABLE')
  const parsed = JSON.parse(stdout.slice(start)) as Partial<McpStatusReport>
  return { servers: Array.isArray(parsed.servers) ? parsed.servers : [], errors: Array.isArray(parsed.errors) ? parsed.errors : [], note: parsed.note }
}

export async function readMcpStatus(env: McpCliEnv): Promise<McpStatusReport> {
  const res = await runMcpCli(['list', '--json'], env, { timeoutMs: 90_000 })
  try {
    return parseStatus(res.stdout)
  } catch {
    throw new Error(res.stderr.trim() || 'MCP_STATUS_UNREADABLE')
  }
}
