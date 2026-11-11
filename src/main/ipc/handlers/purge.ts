import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  getAgentPurgeConfig,
  getPurgedSessions,
  importPersonasFromDirectory,
  importPersonasFromGithub,
  resetBuiltinPurgePersonas,
  resolveLocalAgentPurgePersonasDir,
  saveAgentPurgeConfig,
} from '../../agent-purge-service'

export function registerPurgeHandlers(): void {
  registerHandler('ipc:purge.getState', async () => ({
    config: getAgentPurgeConfig(),
    purgedSessions: getPurgedSessions(),
    localDir: resolveLocalAgentPurgePersonasDir(),
  }))

  registerHandlerWithSchema(
    'ipc:purge.saveConfig',
    z.object({ config: z.record(z.unknown()) }),
    async (req) => ({
      ok: true,
      config: saveAgentPurgeConfig(req.config),
    }),
  )

  registerHandler('ipc:purge.resetBuiltins', async () => ({
    ok: true,
    config: resetBuiltinPurgePersonas(),
  }))

  registerHandlerWithSchema(
    'ipc:purge.importLocal',
    z.object({ dir: z.string().max(4096).optional() }),
    async (req) => {
      const res = importPersonasFromDirectory(req.dir)
      return { ok: true, count: res.imported.length, config: res.config, dir: res.dir }
    },
  )

  registerHandlerWithSchema(
    'ipc:purge.importGithub',
    z.object({ source: z.string().min(1).max(1024) }),
    async (req) => {
      const res = await importPersonasFromGithub(req.source)
      return { ok: true, count: res.imported.length, config: res.config }
    },
  )
}
