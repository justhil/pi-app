import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { applyPiSettingsPatch } from '../pi-settings-patch.js'
import { piSettingsSnapshot, refreshSettingsManager } from '../pi-settings-snapshot.js'
import { st } from '../worker-runtime.js'

export async function handleGetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          if (!st.sdk) {
            reply({ type: 'getPiSettings-done', settings: {} })
            return
          }
          const sm = st.session?.settingsManager
            ?? st.sdk.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk.getAgentDir())
          await refreshSettingsManager(sm)
          reply({ type: 'getPiSettings-done', settings: piSettingsSnapshot(sm) })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getPiSettings failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleSetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const sm = st.session?.settingsManager
            ?? st.sdk!.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk!.getAgentDir())
          const patch = msg.patch || {}
          await applyPiSettingsPatch(sm, patch)
          reply({ type: 'setPiSettings-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `setPiSettings failed: ${errorMessage(e)}` })
        }
        return
}

