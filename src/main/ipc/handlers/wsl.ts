import { registerHandler } from '../registry'
import { listWslDistros, probeWslDistro } from '../../wsl/detection'

export function registerWslHandlers(): void {
  registerHandler('ipc:wsl.listDistros', async () => {
    return { distros: await listWslDistros() }
  })

  registerHandler('ipc:wsl.probeDistro', async (req) => {
    const distro = String(req.distro ?? '')
    if (!distro) return { ok: false, error: 'missing distro' }
    return { result: await probeWslDistro(distro) }
  })
}
