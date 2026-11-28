import { registerHandler } from '../registry'
import {
  cancelGoogleAiPlanLogin,
  getGoogleAiPlanStatus,
  logoutGoogleAiPlan,
  previewGoogleAiPlanSync,
  removeGoogleAiPlanExtension,
  startGoogleAiPlanLogin,
  submitGoogleAiPlanCallbackUrl,
  syncGoogleAiPlanExtension,
} from '../../google-ai-plan/service'

export function registerGoogleAiPlanHandlers(): void {
  registerHandler('ipc:googleAiPlan.status', async () => getGoogleAiPlanStatus())

  registerHandler('ipc:googleAiPlan.previewSync', async () => previewGoogleAiPlanSync())

  // Installs only the commit the user confirmed from previewSync.
  registerHandler('ipc:googleAiPlan.syncExtension', async (req) => syncGoogleAiPlanExtension(String(req?.sha || '')))

  registerHandler('ipc:googleAiPlan.removeExtension', async () => removeGoogleAiPlanExtension())

  registerHandler('ipc:googleAiPlan.loginStart', async () => startGoogleAiPlanLogin())

  registerHandler('ipc:googleAiPlan.loginSubmitUrl', async (req) =>
    submitGoogleAiPlanCallbackUrl(String(req?.callbackUrl || '')),
  )

  registerHandler('ipc:googleAiPlan.loginCancel', async () => cancelGoogleAiPlanLogin())

  registerHandler('ipc:googleAiPlan.logout', async () => logoutGoogleAiPlan())
}
