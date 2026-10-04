import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTERS_FILE, normalizeRouters } from '@shared/model-routers'
import { registerHandler } from '../registry'
import { resolveActiveAgentDir } from '../../agent-dir'
import { workerManager } from '../../worker-manager'

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
