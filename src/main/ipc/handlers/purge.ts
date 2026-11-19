import { z } from 'zod'
import { AGENT_PURGE_MODES } from '@shared/agent-purge'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { purgeStrategyPatchSchema } from '../schemas'
import {
  getActivePurgeForSession,
  getAgentPurgeConfig,
  getPurgedSessions,
  importPersonasFromDirectory,
  importPersonasFromGithub,
  resetBuiltinPurgePersonas,
  resolveLocalAgentPurgePersonasDir,
  saveAgentPurgeConfig,
  setPurgedSession,
} from '../../agent-purge-service'
import { capabilitySectionMap, capabilityToolFamilies } from '../../capabilities/catalog'
import { configStore } from '../../config-store'
import { remoteTap } from '../../remote/tap'
import { workerManager } from '../../worker-manager'

export function registerPurgeHandlers(): void {
  registerHandler('ipc:purge.getState', async () => ({
    config: getAgentPurgeConfig(),
    purgedSessions: getPurgedSessions(),
    localDir: resolveLocalAgentPurgePersonasDir(),
  }))

  registerHandlerWithSchema(
    'ipc:purge.saveConfig',
    z.object({ config: z.record(z.unknown()) }),
    async (req) => {
      const config = saveAgentPurgeConfig(req.config)
      remoteTap.settingsChanged('purge')
      return { ok: true, config }
    },
  )

  registerHandlerWithSchema(
    'ipc:purge.setSession',
    z.object({
      sessionFile: z.string().min(1).max(4096),
      enabled: z.boolean(),
      personaId: z.string().max(128).optional(),
      mode: z.enum(AGENT_PURGE_MODES).optional(),
      strategy: purgeStrategyPatchSchema.optional(),
    }),
    async (req) => {
      const record = setPurgedSession(req.sessionFile, {
        enabled: req.enabled,
        personaId: req.personaId,
        mode: req.mode,
        strategy: req.strategy,
      })
      if (workerManager.hasLiveSessionWorker(req.sessionFile)) {
        const capMap = (configStore.get('sessionCapabilities') || {}) as Record<string, string[]>
        const caps = capMap[req.sessionFile] ?? []
        await workerManager
          .setCapabilities(
            capabilitySectionMap(caps),
            capabilityToolFamilies(caps),
            req.sessionFile,
            getActivePurgeForSession(req.sessionFile),
          )
          .catch(() => {})
      }
      remoteTap.settingsChanged('purge', req.sessionFile)
      return { ok: true, purgedSessions: getPurgedSessions(), record }
    },
  )

  registerHandler('ipc:purge.resetBuiltins', async () => {
    const config = resetBuiltinPurgePersonas()
    remoteTap.settingsChanged('purge')
    return { ok: true, config }
  })

  registerHandlerWithSchema(
    'ipc:purge.importLocal',
    z.object({ dir: z.string().max(4096).optional() }),
    async (req) => {
      const res = importPersonasFromDirectory(req.dir)
      if (res.imported.length) remoteTap.settingsChanged('purge')
      return { ok: true, count: res.imported.length, config: res.config, dir: res.dir }
    },
  )

  registerHandlerWithSchema(
    'ipc:purge.importGithub',
    z.object({ source: z.string().min(1).max(1024) }),
    async (req) => {
      const res = await importPersonasFromGithub(req.source)
      if (res.imported.length) remoteTap.settingsChanged('purge')
      return { ok: true, count: res.imported.length, config: res.config }
    },
  )
}
