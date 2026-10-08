import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { ensureBrowserSubscription, onBrowserSideEvent } from './browser-store'

/**
 * App-wide, whatever panels are on: the agent asking for help must always reach the user. A
 * built-in browser request brings the Browser panel forward; a Chrome request shows above the
 * composer (and as a Chrome notification, sent by Main).
 */
export function useBrowserHelpAttention(browserPanelEnabled: boolean): void {
  const { t } = useTranslation('browser')
  useEffect(() => {
    ensureBrowserSubscription()
    return onBrowserSideEvent((event) => {
      if (event.type !== 'help-request') return
      if (event.request.where === 'builtin' && browserPanelEnabled) {
        const ui = useUIStore.getState()
        ui.setActivePanel('browser')
        if (ui.rightPanelCollapsed) ui.toggleRightPanel()
      }
      toast(t('agent.helpTitle'), { description: event.request.prompt })
    })
  }, [browserPanelEnabled, t])
}
