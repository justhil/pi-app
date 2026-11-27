import { registerHandler } from '../registry'
import {
  cancelGoogleAiPlanLogin,
  getGoogleAiPlanStatus,
  logoutGoogleAiPlan,
  removeGoogleAiPlanExtension,
  startGoogleAiPlanLogin,
  submitGoogleAiPlanCallbackUrl,
  syncGoogleAiPlanExtension,
} from '../../google-ai-plan/service'

export function registerGoogleAiPlanHandlers(): void {
  registerHandler('ipc:googleAiPlan.status', async () => getGoogleAiPlanStatus())

  registerHandler('ipc:googleAiPlan.syncExtension', async () => syncGoogleAiPlanExtension())

  registerHandler('ipc:googleAiPlan.removeExtension', async () => removeGoogleAiPlanExtension())

  registerHandler('ipc:googleAiPlan.loginStart', async (req) =>
    startGoogleAiPlanLogin({ autoSync: req?.autoSync !== false }),
  )

  registerHandler('ipc:googleAiPlan.loginSubmitUrl', async (req) =>
    submitGoogleAiPlanCallbackUrl(String(req?.callbackUrl || '')),
  )

  registerHandler('ipc:googleAiPlan.loginCancel', async () => cancelGoogleAiPlanLogin())

  registerHandler('ipc:googleAiPlan.logout', async () => logoutGoogleAiPlan())
}
