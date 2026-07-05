import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import * as Turn from './handlers/worker-handlers-turn.js'
import * as Session from './handlers/worker-handlers-session.js'
import * as Catalog from './handlers/worker-handlers-catalog.js'
import * as PiSettings from './handlers/worker-handlers-pi-settings.js'

const dispatch: Record<string, (msg: WorkerIncomingMessage, reply: WorkerReply) => Promise<void>> = {
  'init': Turn.handleInit,
  'prompt': Turn.handlePrompt,
  'abort': Turn.handleAbort,
  'steer': Turn.handleSteer,
  'followUp': Turn.handleFollowup,
  'clearQueue': Turn.handleClearqueue,
  'extension-ui-response': Turn.handleExtensionUiResponse,
  'dispose': Turn.handleDispose,
  'ping': Turn.handlePing,
  'setModel': Session.handleSetmodel,
  'setThinkingLevel': Session.handleSetthinkinglevel,
  'newSession': Session.handleNewsession,
  'listSessions': Session.handleListsessions,
  'loadSession': Session.handleLoadsession,
  'sessionRenameFile': Session.handleSessionrenamefile,
  'sessionDeleteFile': Session.handleSessiondeletefile,
  'getSessionTree': Session.handleGetsessiontree,
  'navigateTree': Session.handleNavigatetree,
  'runExtensionCommand': Session.handleRunextensioncommand,
  'getMessages': Session.handleGetmessages,
  'reloadModels': Catalog.handleReloadmodels,
  'getModels': Catalog.handleGetmodels,
  'getCommands': Catalog.handleGetcommands,
  'getSessionContextPreview': Catalog.handleGetsessioncontextpreview,
  'getSkillsList': Catalog.handleGetskillslist,
  'getPromptTemplatesList': Catalog.handleGetprompttemplateslist,
  'getContextPrompts': Catalog.handleGetcontextprompts,
  'reloadResources': Catalog.handleReloadresources,
  'getCommandCompletions': Catalog.handleGetcommandcompletions,
  'getState': Catalog.handleGetstate,
  'getPiSettings': PiSettings.handleGetpisettings,
  'setPiSettings': PiSettings.handleSetpisettings,
}

export async function handleWorkerPortMessage(
  msg: WorkerIncomingMessage,
  reply: WorkerReply,
): Promise<void> {
  try {
    const type = msg.type
    const handler = type ? dispatch[type] : undefined
    if (!handler) {
      reply({ type: 'error', error: `Unknown message type: ${String(type)}` })
      return
    }
    await handler(msg, reply)
  } catch (error) {
    reply({ type: 'error', error: String(error), stack: (error as Error)?.stack })
  }
}
