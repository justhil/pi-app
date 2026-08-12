import { configStore } from './config-store'
import { sessionPreviewProcess } from './session-preview-process'

export async function writePiAgentGlobalSettings(
  patch: Record<string, unknown>,
): Promise<void> {
  const cwd = configStore.get('currentProject') || process.cwd()
  await sessionPreviewProcess.setPiSettings(patch, cwd)
}
