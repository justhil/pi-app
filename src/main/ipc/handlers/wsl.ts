import { registerHandler } from '../registry'
import { listWslDistrosAsync, probeWslDistroAsync } from '../../wsl/detection'

export function registerWslHandlers(): void {
  registerHandler('ipc:wsl.listDistros', async () => {
    return { distros: await listWslDistrosAsync() }
  })

  registerHandler('ipc:wsl.probeDistro', async (req) => {
    const distro = String(req.distro ?? '')
    if (!distro) return { ok: false, error: 'missing distro' }
    return { result: await probeWslDistroAsync(distro, { force: req.force === true }) }
  })
}
