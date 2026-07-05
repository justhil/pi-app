import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export type DesktopSlashRouteResult = { handled: true } | { handled: false }

/** config-page / open-panel 不走 prompt，避免扩展挂起导致「Agent 启动中」卡死 */
export async function routeDesktopSlashBeforeSend(line: string): Promise<DesktopSlashRouteResult> {
  const trimmed = line.trim()
  const token = trimmed.match(/^(\/\S+)/)?.[1]
  if (!token) return { handled: false }

  let resolved: {
    behavior?: string
    meta?: { matchNames?: string[]; adapterId?: string; panelId?: string; desktopSupport?: string }
  } | null = null
  try {
    resolved = await ipcClient.invoke('slash.resolve', { command: token })
  } catch (e) {
    return { handled: false }
  }

  const behavior = resolved?.behavior
  if (!behavior || behavior === 'passthrough' || behavior === 'notify' || behavior === 'execute') {
    return { handled: false }
  }

  const store = useUIStore.getState()
  const meta = resolved?.meta

  if (behavior === 'config-page') {
    const name = meta?.matchNames?.[0] || meta?.adapterId || token.replace(/^\//, '')
    store.requestExtensionConfig(name)
    toast.info(i18n.t('composer:toast.openedConfig', { name }))
    return { handled: true }
  }

  if (behavior === 'open-panel') {
    const panel = meta?.panelId || `adapter:${meta?.adapterId || ''}`
    if (!panel || panel === 'adapter:') {
      toast.error(i18n.t('composer:toast.slashNoPanel'))
      return { handled: true }
    }
    store.setActivePanel(panel)
    toast.info(meta?.desktopSupport || i18n.t('composer:toast.openedPanel', { panel }))
    return { handled: true }
  }

  return { handled: false }
}