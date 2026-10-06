import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  regenerateRemotePairing,
  remoteStatus,
  removeRemoteDevice,
  revokeRemoteDevice,
  setRemoteDeviceRole,
  setRemoteEnabled,
  setRemotePort,
  setRemoteProjects,
} from '../../remote-gateway-service'

/** Settings → 手机连接. */
export function registerRemoteHandlers(): void {
  registerHandler('ipc:remote.status', async () => remoteStatus())
  registerHandlerWithSchema('ipc:remote.setEnabled', z.object({ enabled: z.boolean() }), async (req) => setRemoteEnabled(req.enabled))
  registerHandlerWithSchema('ipc:remote.setPort', z.object({ port: z.number().int().min(1024).max(65535) }), async (req) => setRemotePort(req.port))
  registerHandler('ipc:remote.regeneratePairing', async () => regenerateRemotePairing())
  registerHandlerWithSchema('ipc:remote.setProjects', z.object({ projects: z.array(z.string()).max(200) }), async (req) => setRemoteProjects(req.projects))
  registerHandlerWithSchema('ipc:remote.revokeDevice', z.object({ id: z.string() }), async (req) => revokeRemoteDevice(req.id))
  registerHandlerWithSchema('ipc:remote.removeDevice', z.object({ id: z.string() }), async (req) => removeRemoteDevice(req.id))
  registerHandlerWithSchema(
    'ipc:remote.setDeviceRole',
    z.object({ id: z.string(), role: z.enum(['viewer', 'operator']) }),
    async (req) => setRemoteDeviceRole(req.id, req.role),
  )
}
