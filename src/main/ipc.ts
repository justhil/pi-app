import { registerDialogHandlers } from './ipc/handlers/dialog'
import { registerWorkspaceFsHandlers } from './ipc/handlers/workspace-fs'
import { registerWorkspaceHandlers } from './ipc/handlers/workspace'
import { registerSessionHandlers } from './ipc/handlers/session'
import { registerPromptHandlers } from './ipc/handlers/prompt'
import { registerSettingsHandlers } from './ipc/handlers/settings'
import { registerWindowControlHandlers } from './ipc/handlers/window-controls'
import { registerModelRuntimeHandlers } from './ipc/handlers/model-runtime'
import { registerExtensionHandlers } from './ipc/handlers/extensions'
import { registerExtensionUiHandlers } from './ipc/handlers/extension-ui'
import { registerAdapterPanelHandlers } from './ipc/handlers/adapter-panels'
import { registerSkillsResourceHandlers } from './ipc/handlers/skills-resources'
import { registerReviewHandlers } from './ipc/handlers/review'
import { registerCommandsSlashHandlers } from './ipc/handlers/commands-slash'
import { registerAsrHandlers } from './ipc/handlers/asr'
import { registerPiSdkHandlers } from './ipc/handlers/pi-sdk'

export { registerHandler, sendEvent } from './ipc/registry'

export function registerAllHandlers(): void {
  registerDialogHandlers()
  registerWorkspaceFsHandlers()
  registerWorkspaceHandlers()
  registerSessionHandlers()
  registerPromptHandlers()
  registerSettingsHandlers()
  registerWindowControlHandlers()
  registerExtensionUiHandlers()
  registerModelRuntimeHandlers()
  registerExtensionHandlers()
  registerAdapterPanelHandlers()
  registerSkillsResourceHandlers()
  registerReviewHandlers()
  registerCommandsSlashHandlers()
  registerAsrHandlers()
  registerPiSdkHandlers()
}