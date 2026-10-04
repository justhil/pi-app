import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { registerHandler } from '../registry'
import { configStore } from '../../config-store'
import { workerManager } from '../../worker-manager'
import { resolveActiveAgentDir } from '../../agent-dir'
import { resolveActiveSdk, resolveActiveSdkRoot } from '../../sdk-loader'
import { getAgentRuntimeConfig } from '../../wsl/runtime-config'
import {
  MCP_EXPOSURES,
  type McpExposure,
  type McpServerConfig,
  globalMcpPath,
  parseImport,
  patchServer,
  projectMcpPath,
  readMcpConfig,
  removeServer,
  saveServer,
  setAutoEnableCodemode,
} from '../../mcp/mcp-config'
import { readMcpStatus, runMcpCli, type McpCliEnv } from '../../mcp/mcp-cli'

type Scope = 'global' | 'project'

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

function currentProject(): string | null {
  const raw = workerManager.cwd || configStore.get('currentProject')
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

/** Same rule as `pi mcp`: the project file is read only for projects the trust store marks trusted. */
async function projectTrusted(agentDir: string, project: string | null): Promise<boolean> {
  if (!project) return false
  try {
    const active = resolveActiveSdk(app.getPath('userData'))
    const sdk = (await (active.kind === 'builtin' ? import(active.entryPath) : import(pathToFileURL(active.entryPath).href))) as {
      ProjectTrustStore?: new (dir: string) => { get(cwd: string): boolean | null | undefined }
    }
    return sdk.ProjectTrustStore ? new sdk.ProjectTrustStore(agentDir).get(project) === true : false
  } catch {
    return false
  }
}

function hostOnly(): void {
  if (getAgentRuntimeConfig().mode === 'wsl') throw new Error('MCP_WSL_UNSUPPORTED')
}

function pathFor(scope: Scope, agentDir: string, project: string | null): string {
  if (scope === 'global') return globalMcpPath(agentDir)
  if (!project) throw new Error('MCP_NO_PROJECT')
  return projectMcpPath(project)
}

function cliEnv(agentDir: string, project: string | null): McpCliEnv {
  const sdkRoot = resolveActiveSdkRoot(app.getPath('userData'))
  if (!sdkRoot) throw new Error('MCP_CLI_UNAVAILABLE')
  return { sdkRoot, agentDir, cwd: project ?? agentDir }
}

const asExposure = (v: unknown): McpExposure | null | undefined =>
  v === null ? null : MCP_EXPOSURES.includes(v as McpExposure) ? (v as McpExposure) : undefined

export function registerMcpHandlers(): void {
  registerHandler('ipc:mcp.config.get', async () => {
    try {
      hostOnly()
      const agentDir = resolveActiveAgentDir()
      const project = currentProject()
      const trusted = await projectTrusted(agentDir, project)
      return { ok: true, project, projectTrusted: trusted, ...readMcpConfig({ agentDir, project, projectTrusted: trusted }) }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:mcp.server.save', async (req: { scope?: Scope; name?: string; config?: McpServerConfig; previousName?: string }) => {
    try {
      hostOnly()
      if (!req?.name || !req.config || typeof req.config !== 'object') throw new Error('MCP_BAD_REQUEST')
      saveServer(pathFor(req.scope === 'project' ? 'project' : 'global', resolveActiveAgentDir(), currentProject()), req.name, req.config, req.previousName)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:mcp.server.remove', async (req: { scope?: Scope; name?: string }) => {
    try {
      hostOnly()
      if (!req?.name) throw new Error('MCP_BAD_REQUEST')
      removeServer(pathFor(req.scope === 'project' ? 'project' : 'global', resolveActiveAgentDir(), currentProject()), req.name)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  /** enabled / exposure where the server is defined, or as a project override with `target: 'override'`. */
  registerHandler(
    'ipc:mcp.server.patch',
    async (req: { name?: string; target?: Scope | 'override'; enabled?: boolean | null; exposure?: string | null }) => {
      try {
        hostOnly()
        if (!req?.name) throw new Error('MCP_BAD_REQUEST')
        const agentDir = resolveActiveAgentDir()
        const project = currentProject()
        const override = req.target === 'override'
        const path = pathFor(override || req.target === 'project' ? 'project' : 'global', agentDir, project)
        const patch: { enabled?: boolean; exposure?: McpExposure | null } = {}
        if ('enabled' in req) patch.enabled = req.enabled ?? undefined
        if ('exposure' in req) {
          const exposure = asExposure(req.exposure)
          if (exposure === undefined) throw new Error('MCP_BAD_EXPOSURE')
          patch.exposure = exposure
        }
        patchServer(path, req.name, patch, { override })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: errorMessage(e) }
      }
    },
  )

  registerHandler('ipc:mcp.autoCodemode.set', async (req: { value?: boolean }) => {
    try {
      hostOnly()
      setAutoEnableCodemode(globalMcpPath(resolveActiveAgentDir()), req?.value !== false)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:mcp.import', async (req: { scope?: Scope; text?: string }) => {
    try {
      hostOnly()
      const { servers, problems } = parseImport(String(req?.text ?? ''))
      const path = pathFor(req?.scope === 'project' ? 'project' : 'global', resolveActiveAgentDir(), currentProject())
      for (const [name, config] of Object.entries(servers)) saveServer(path, name, config)
      return { ok: true, added: Object.keys(servers), problems }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:mcp.status', async () => {
    try {
      hostOnly()
      const agentDir = resolveActiveAgentDir()
      return { ok: true, ...(await readMcpStatus(cliEnv(agentDir, currentProject()))) }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  // Sign-in opens the browser and waits for the redirect (pi's default: up to 300 s).
  registerHandler('ipc:mcp.login', async (req: { name?: string }) => {
    try {
      hostOnly()
      if (!req?.name || !/^[A-Za-z0-9_-]+$/.test(req.name)) throw new Error('MCP_BAD_REQUEST')
      const res = await runMcpCli(['login', req.name], cliEnv(resolveActiveAgentDir(), currentProject()), { timeoutMs: 320_000 })
      return res.code === 0 ? { ok: true } : { ok: false, error: (res.stderr || res.stdout).trim().split('\n').pop() || 'MCP_LOGIN_FAILED' }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:mcp.logout', async (req: { name?: string }) => {
    try {
      hostOnly()
      if (!req?.name || !/^[A-Za-z0-9_-]+$/.test(req.name)) throw new Error('MCP_BAD_REQUEST')
      const res = await runMcpCli(['logout', req.name], cliEnv(resolveActiveAgentDir(), currentProject()))
      return res.code === 0 ? { ok: true } : { ok: false, error: (res.stderr || res.stdout).trim() || 'MCP_LOGOUT_FAILED' }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })
}
