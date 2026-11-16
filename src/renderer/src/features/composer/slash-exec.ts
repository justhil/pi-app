// Slash command execution semantics (A-layer, tui-replacement-and-adapters.md §2.4)
// - builtin (app-native) -> route to dedicated IPC (NOT sent as prompt text) + toast feedback
// - /skill:, /prompt: -> expand then send (sent as prompt text; pi handles slash in message)
// - extension commands -> resolved via slash.resolve, notify/send to pi

import { toast } from 'sonner'
import { errorMessage } from '@shared/error-message'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { ensureAvailableModels } from '@renderer/lib/available-models-cache'
import { commitSessionDisplayMeta } from '@renderer/lib/session-display-meta'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'

/** App-native builtins handled directly in the renderer (not forwarded as plain prompt text). */
const APP_BUILTIN = new Set([
  'model', 'thinking', 'clear', 'compact', 'new', 'fork', 'clone',
  'help', 'settings', 'review', 'run', 'tree', 'skills', 'prompts',
])

export function isExecutableBuiltin(input: string): boolean {
  const token = firstToken(input)
  return !!token && APP_BUILTIN.has(token.slice(1))
}

export interface SlashExecContext {
  refreshCommands?: () => Promise<void>
}

function firstToken(input: string): string | null {
  const m = input.match(/^(\/\S+)/)
  return m ? m[1] : null
}

export { firstToken }

const THINKING_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Execute an app-native slash command. Returns true if handled (caller clears input).
 */
export async function executeSlashCommand(
  input: string,
  ctx: SlashExecContext = {},
): Promise<boolean> {
  const m = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!m) return false
  const cmd = m[1]
  const arg = (m[2] || '').trim()
  const store = useUIStore.getState()
  const setActivePanel = store.setActivePanel

  switch (cmd) {
    case 'model': {
      // No arg -> open picker panel; with arg -> set directly
      if (!arg) {
        store.setModelPickerOpen(true)
        return true
      }
      try {
        let provider: string | undefined
        let modelId: string | undefined
        const separator = arg.indexOf('/')
        if (separator >= 0) {
          provider = arg.slice(0, separator)
          modelId = arg.slice(separator + 1)
        } else {
          const models = await ensureAvailableModels()
          const hit = models.find((mm) => mm.id === arg || mm.name === arg)
          provider = hit?.provider
          modelId = hit?.id
        }
        if (!provider || !modelId) {
          toast.error(i18n.t('composer:modelNotFound', { arg }))
          return true
        }
        const requestedModel = `${provider}/${modelId}`
        const sessionFile = store.historySessionFile
        if (!sessionFile) {
          store.setRunState({ model: requestedModel })
          toast.success(i18n.t('composer:toast.modelSet', { model: requestedModel }))
          return true
        }
        const response = await ipcClient.invoke('model.set', {
          sessionId: '',
          sessionFile,
          provider,
          modelId,
        })
        // Lands on the session the command ran in, even if the view switched while it awaited.
        useUIStore.getState().setSessionRunState(sessionFile, { model: response.modelId })
        commitSessionDisplayMeta(sessionFile, { model: response.modelId })
        toast.success(i18n.t('composer:toast.modelSet', { model: response.modelId }))
      } catch (e) {
        console.error('/model failed:', e)
        toast.error(i18n.t('composer:switchModelFailed'))
      }
      return true
    }
    case 'thinking': {
      // No arg -> open picker; with valid arg -> set directly
      if (!arg) {
        store.setThinkingPickerOpen(true)
        return true
      }
      if (!THINKING_ORDER.includes(arg)) {
        toast.error(i18n.t('composer:invalidThinkingLevel', { arg, options: THINKING_ORDER.join('/') }))
        return true
      }
      try {
        // Scope to the viewed session like the thinking picker — the foreground worker may be another session.
        const sessionFile = store.historySessionFile
        const sessionKey = store.viewSessionKey ?? ''
        if (sessionFile) {
          await ipcClient.invoke('thinkingLevel.set', {
            sessionId: '',
            sessionFile,
            level: arg,
          })
        }
        commitSessionDisplayMeta(sessionFile, { thinkingLevel: arg })
        useUIStore.getState().setSessionRunState(sessionFile ?? sessionKey, { thinkingLevel: arg })
        if (sessionFile && !sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) return true
        toast.success(`Thinking: ${arg}`)
      } catch (e) {
        console.error('/thinking failed:', e)
        toast.error(i18n.t('composer:switchThinkingFailed'))
      }
      return true
    }
    case 'clear': {
      store.clearTimeline()
      toast.success(i18n.t('composer:timelineCleared'))
      return true
    }
    case 'compact': {
      try {
        if (!store.historySessionFile) throw new Error(i18n.t('composer:noSessionToCompact'))
        const result = await ipcClient.invoke('session.compact', {
          sessionId: '',
          sessionFile: store.historySessionFile,
          workspaceId: store.currentWorkspace ?? undefined,
          customInstructions: arg || undefined,
        })
        if (!result?.compacted) throw new Error(result?.error || i18n.t('composer:compactionFailed'))
        toast.success(i18n.t('composer:compactedHistory'))
      } catch (e) {
        console.error('/compact failed:', e)
        toast.error(i18n.t('composer:compactionFailed'), { description: errorMessage(e) })
      }
      return true
    }
    case 'new': {
      try {
        const store = useUIStore.getState()
        const wid = store.currentWorkspace
        if (!wid) {
          toast.error(i18n.t('composer:toast.needWorkspace'))
          return true
        }
        enterBlankSession('pending-project')
        void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
        toast.info(i18n.t('composer:toast.newSessionReady'))
      } catch (e) {
        console.error('/new failed:', e)
        toast.error(i18n.t('composer:toast.newSessionFailed'))
      }
      return true
    }
    case 'fork': {
      try {
        const { useUIStore: storeMod } = await import('@renderer/stores/ui-store')
        // Prefer explicit open of fork overlay via custom event (App listens).
        window.dispatchEvent(new CustomEvent('pi-desktop:open-fork-selector'))
        void storeMod
      } catch (e) {
        console.error('/fork failed:', e)
        toast.error(i18n.t('composer:toast.forkSelectorFailed'))
      }
      return true
    }
    case 'clone': {
      try {
        const { cloneCurrentSession } = await import('@renderer/lib/session-fork')
        await cloneCurrentSession()
      } catch (e) {
        console.error('/clone failed:', e)
        toast.error(i18n.t('composer:toast.cloneFailed'))
      }
      return true
    }
    case 'review': { setActivePanel('review'); toast.info(i18n.t('composer:toast.panelSwitched', { panel: i18n.t('common:panel.review') })); return true }
    case 'run': { setActivePanel('run'); toast.info(i18n.t('composer:toast.panelSwitched', { panel: i18n.t('common:panel.run') })); return true }
    case 'tree': { setActivePanel('tree'); return true }
    case 'settings': { toast.info(i18n.t('composer:toast.openSettingsFromSidebar')); return true }
    case 'skills':
    case 'prompts':
    case 'help': {
      toast.info(i18n.t('composer:toast.continueTyping', { cmd }))
      return true
    }
    default:
      return false
  }
}
