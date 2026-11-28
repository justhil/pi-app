import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { toSshDistro, wslPathToWindows } from '@shared/wsl-path'
import { configStore } from '../../config-store'
import { findSshHostEntry, isValidSshHost, listSshHosts, removeSshHostEntry, saveSshHostEntry } from '../../ssh/ssh-config'
import { listSshRemoteDirs } from '../../ssh/ssh-exec'
import { probeWslDistro } from '../../wsl/detection'
import type { AgentRuntimeConfig } from '../../wsl/runtime-config'
import { resolveWslEnv } from '../../wsl/wsl-env'
import { registerHandler, registerHandlerWithSchema, sendEvent } from '../registry'

const hostRequest = z.object({ host: z.string().trim().refine(isValidSshHost, 'Invalid SSH host') })
const saveRequest = hostRequest.extend({
  label: z.string().optional(),
  hostName: z.string().optional(),
  user: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().optional(),
  remotePath: z.string().optional(),
})
const connectRequest = z.discriminatedUnion('enabled', [
  hostRequest.extend({ enabled: z.literal(true), remotePath: z.string().optional() }),
  z.object({ enabled: z.literal(false) }),
])

function expandRemoteHome(remotePath: string, home: string): string {
  const path = remotePath.trim()
  if (!path || path === '~') return home || '/'
  if (path.startsWith('/')) return path
  const relative = path.startsWith('~/') ? path.slice(2) : path
  return `${home.replace(/\/+$/, '')}/${relative}`
}

function busyResponse() {
  return { ok: false, error: 'AGENT_RUNTIME_BUSY', hosts: listSshHosts() }
}

async function switchRuntime(runtime: AgentRuntimeConfig): Promise<boolean> {
  const [worker, preview, catalog, sdk] = await Promise.all([
    import('../../worker-manager'),
    import('../../session-preview-process'),
    import('../../../extension-compat/adapter-loader'),
    import('../../sdk-manager'),
  ])
  if (worker.workerManager.hasActiveTurns) return false
  await worker.workerManager.stop()
  preview.sessionPreviewProcess.stop()
  configStore.set('agentRuntime', runtime)
  catalog.invalidateAdapterCatalog()
  sdk.invalidateSdkManagerCaches()
  for (const win of BrowserWindow.getAllWindows()) {
    sendEvent(win, { type: 'sdk-runtime-changed' })
  }
  return true
}

async function disconnectSsh() {
  const runtime = { mode: 'host' as const, distro: null }
  if (!await switchRuntime(runtime)) return busyResponse()
  return { ok: true, enabled: false, activeHost: null, runtime, hosts: listSshHosts() }
}

async function connectSsh(request: z.infer<typeof connectRequest>) {
  if (!request.enabled) return disconnectSsh()
  const { workerManager } = await import('../../worker-manager')
  if (workerManager.hasActiveTurns) return busyResponse()

  const host = request.host.replace(/^ssh@/i, '')
  const distro = toSshDistro(host)
  const env = await resolveWslEnv(distro, { force: true })
  if (!env) return { ok: false, error: 'SSH_ENV_UNAVAILABLE', hosts: listSshHosts() }

  const requestedPath = request.remotePath?.trim()
  const remotePath = expandRemoteHome(requestedPath || findSshHostEntry(host)?.remotePath || '~', env.home)
  if (requestedPath) saveSshHostEntry({ host, remotePath: requestedPath })
  const runtime = { mode: 'wsl' as const, distro }
  if (!await switchRuntime(runtime)) return busyResponse()
  void import('../../startup-warmup').then((m) => m.warmWslRuntime(distro)).catch((error) => {
    console.warn('[SSH] Runtime warmup failed:', error)
  })
  return {
    ok: true, enabled: true, activeHost: host, runtime, remotePath,
    workspacePath: wslPathToWindows(distro, remotePath), hosts: listSshHosts(),
  }
}

export function registerSshHandlers(): void {
  registerHandler('ipc:ssh.listHosts', async () => {
    const hosts = listSshHosts()
    return { hosts, activeHost: hosts.find((host) => host.enabled)?.host ?? null, runtime: configStore.get('agentRuntime') }
  })
  registerHandlerWithSchema('ipc:ssh.saveHost', saveRequest, async (request) => ({
    ok: true, hosts: saveSshHostEntry(request),
  }))
  registerHandlerWithSchema('ipc:ssh.removeHost', hostRequest, async ({ host }) => ({
    ok: true, hosts: removeSshHostEntry(host),
  }))
  registerHandlerWithSchema('ipc:ssh.probeHost', hostRequest.extend({ refresh: z.boolean().optional() }), async ({ host, refresh }) => ({
    result: await probeWslDistro(toSshDistro(host), { refresh }),
  }))
  registerHandlerWithSchema('ipc:ssh.listRemoteDir', hostRequest.extend({ path: z.string().optional() }), async ({ host, path }) =>
    listSshRemoteDirs(toSshDistro(host), path),
  )
  registerHandlerWithSchema('ipc:ssh.connect', connectRequest, connectSsh)
}
