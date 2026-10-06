import { ipcMain } from 'electron'
import { registerHandler } from '../registry'
import { configStore } from '../../config-store'
import { terminalProfiles, terminals } from '../../terminal/terminal-service'

export function registerTerminalHandlers(): void {
  registerHandler('ipc:terminal.profiles', async (req) => {
    const refresh = (req as { refresh?: boolean } | null)?.refresh === true
    return { profiles: terminalProfiles(refresh) }
  })
  registerHandler('ipc:terminal.create', async (req) => {
    const r = (req ?? {}) as { profileId?: string; cwd?: string; cols?: number; rows?: number }
    const all = terminalProfiles()
    const profile = all.find((p) => p.id === r.profileId) ?? all[0]
    if (!profile) return { ok: false, error: 'no_shell' }
    try {
      // No project in the renderer yet (home view): the last opened project, else home.
      const cwd = r.cwd || (configStore.get('currentProject') as string | undefined) || undefined
      const { id, pid } = terminals().create(profile, { cwd, cols: Number(r.cols), rows: Number(r.rows) })
      return { ok: true, id, pid, profile }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  registerHandler('ipc:terminal.resize', async (req) => {
    const r = (req ?? {}) as { id?: string; cols?: number; rows?: number }
    if (r.id) terminals().resize(r.id, Number(r.cols), Number(r.rows))
    return { ok: true }
  })
  registerHandler('ipc:terminal.kill', async (req) => {
    const id = (req as { id?: string } | null)?.id
    if (id) terminals().kill(id)
    return { ok: true }
  })
  // Keystrokes: fire-and-forget, no invoke round trip per key.
  ipcMain.removeAllListeners('ipc:terminal-write')
  ipcMain.on('ipc:terminal-write', (_e, payload: { id?: string; data?: string }) => {
    if (typeof payload?.id === 'string' && typeof payload.data === 'string') terminals().write(payload.id, payload.data)
  })
}
