import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { getDesktopSkillOverrides, isSkillEnabled } from '../../pi-skill-overrides'
import { mergeSlashCommandLists, scanStaticSlashCommands, type SlashCatalogCommand } from '../../commands-catalog'
import { resolveV2SlashPrefix } from '../../../extension-compat/adapter-loader'

export function registerCommandsSlashHandlers(): void {
  registerHandler('ipc:commands.completions', async (req) => {
    if (!workerManager.isRunning) return { items: [] }
    try {
      return { items: await workerManager.getCommandCompletions(req.commandName, req.argumentPrefix || '') }
    } catch (e) {
      console.error('[IPC] commands.completions failed:', e)
      return { items: [] }
    }
  })

  registerHandler('ipc:commands.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const overrides = getDesktopSkillOverrides()
    const filterSkills = (list: SlashCatalogCommand[]) =>
      list.filter((c) => {
        if (c.category !== 'skill') return true
        const id = String(c.id || c.name || '').replace(/^\/?skill:/, '')
        const path = c.source?.path || c.source?.filePath
        return isSkillEnabled(id, path, overrides)
      })

    const staticCmds = filterSkills(scanStaticSlashCommands(cwd))
    await workerManager.awaitReady()
    if (workerManager.isRunning) {
      try {
        const r = await workerManager.getCommands()
        const workerCmds = filterSkills((r.commands || []) as SlashCatalogCommand[])
        if (r.hasSession && workerCmds.length > 0) {
          return { commands: mergeSlashCommandLists(workerCmds, staticCmds), source: 'worker' }
        }
        if (workerCmds.length > 0) {
          return { commands: mergeSlashCommandLists(workerCmds, staticCmds), source: 'preview' }
        }
      } catch (e) {
        console.error('[IPC] commands.list worker failed:', e)
      }
    }
    if (staticCmds.length > 0) return { commands: staticCmds, source: 'preview' }
    return { commands: [], source: 'fallback' }
  })

  registerHandler('ipc:slash.normalize', async (req) => ({ text: String(req.text ?? '').trim() }))

  registerHandler('ipc:slash.resolve', async (req) => {
    const r = resolveV2SlashPrefix(req.command || '')
    if (!r) return { behavior: 'passthrough', meta: null }
    return {
      behavior: r.behavior,
      meta: {
        matchNames: r.matchNames,
        desktopSupport: r.desktopSupport,
        panelId: r.panelId,
        adapterId: r.adapterId,
      },
    }
  })

  registerHandler('ipc:registry.refresh', async () => ({ refreshed: false, count: 0 }))
}