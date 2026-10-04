import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import { ROUTERS_FILE, normalizeRouters } from '@shared/model-routers'
import { registerHandler } from '../registry'
import { resolveActiveAgentDir } from '../../agent-dir'
import { workerManager } from '../../worker-manager'
import { resolveActiveSdk } from '../../sdk-loader'

type ClassifierRow = { id: string; name: string; provider: string; available: boolean }

/**
 * Classifier models straight from the active SDK's catalog and the user's credentials, for when no
 * session runtime exists yet (a new chat before its first message). Offline: no catalog refresh.
 */
async function classifiersFromSdk(): Promise<ClassifierRow[]> {
  const active = resolveActiveSdk(app.getPath('userData'))
  const sdk = (await (active.kind === 'builtin' ? import(active.entryPath) : import(pathToFileURL(active.entryPath).href))) as {
    ModelRuntime?: { create: (o: Record<string, unknown>) => Promise<{ getModelsOfType?: (t: 'classifier') => readonly { id: string; name?: string; provider: string }[]; getAvailableOfType?: (t: 'classifier') => Promise<readonly { id: string; provider: string }[]> }> }
  }
  if (!sdk.ModelRuntime) return []
  const dir = resolveActiveAgentDir()
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json'), allowModelNetwork: false })
  const all = runtime.getModelsOfType?.('classifier') ?? []
  const available = new Set(((await runtime.getAvailableOfType?.('classifier').catch(() => [])) ?? []).map((m) => `${m.provider}/${m.id}`))
  return all.map((m) => ({ id: m.id, name: m.name || m.id, provider: m.provider, available: available.has(`${m.provider}/${m.id}`) }))
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function registerModelRouterHandlers(): void {
  registerHandler('ipc:routers.get', async () => {
    const path = join(resolveActiveAgentDir(), ROUTERS_FILE)
    if (!existsSync(path)) return { ok: true, path, routers: [], problems: [] }
    try {
      return { ok: true, path, ...normalizeRouters(JSON.parse(readFileSync(path, 'utf8'))) }
    } catch (e) {
      return { ok: false, path, routers: [], problems: [], error: errorMessage(e) }
    }
  })

  registerHandler('ipc:routers.classifiers', async () => {
    try {
      const live = workerManager.isRunning ? await workerManager.getClassifierModels().catch(() => []) : []
      return { models: live.length ? live : await classifiersFromSdk() }
    } catch {
      return { models: [] }
    }
  })

  registerHandler('ipc:routers.set', async (req: { routers?: unknown }) => {
    const { routers, problems } = normalizeRouters({ routers: req?.routers })
    if (problems.length) return { ok: false, error: problems.join('\n') }
    try {
      const dir = resolveActiveAgentDir()
      mkdirSync(dir, { recursive: true })
      const path = join(dir, ROUTERS_FILE)
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify({ routers }, null, 2)}\n`)
      renameSync(tmp, path)
      // Each session registers the routers itself; running ones pick the change up now.
      if (workerManager.isRunning) await workerManager.broadcast('reloadModelRouters')
      return { ok: true, routers }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })
}
