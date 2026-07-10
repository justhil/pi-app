// Slash command execution semantics (A-layer, tui-replacement-and-adapters.md §2.4)
// - builtin (app-native) -> route to dedicated IPC (NOT sent as prompt text) + toast feedback
// - /skill:, /prompt: -> expand then send (sent as prompt text; pi handles slash in message)
// - extension commands -> resolved via slash.resolve, notify/send to pi

import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** App-native builtins handled directly in the renderer (not forwarded as plain prompt text). */
const APP_BUILTIN = new Set([
  'model', 'thinking', 'clear', 'compact', 'new', 'fork', 'clone',
  'help', 'settings', 'review', 'run', 'tree', 'skills', 'prompts',
])

export function isExecutableBuiltin(input: string): boolean {
  const m = input.match(/^\/(\w+)/)
  return !!m && APP_BUILTIN.has(m[1])
}

export interface SlashExecContext {
  refreshCommands?: () => Promise<void>
}

function firstToken(input: string): string | null {
  const m = input.match(/^(\/\S+)/)
  return m ? m[1] : null
}

export { firstToken }

const THINKING_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

/**
 * Execute an app-native slash command. Returns true if handled (caller clears input).
 */
export async function executeSlashCommand(
  input: string,
  ctx: SlashExecContext = {},
): Promise<boolean> {
  const m = input.match(/^\/(\w+)\b *(.*)?$/)
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
        if (arg.includes('/')) {
          const [provider, modelId] = arg.split('/')
          await ipcClient.invoke('model.set', { sessionId: '', provider, modelId })
          store.setRunState({ model: `${provider}/${modelId}` })
          toast.success(i18n.t('composer:toast.modelSet', { model: `${provider}/${modelId}` }))
        } else {
          const res = (await ipcClient.invoke('model.list', {})) as { models?: Array<{ id: string; name?: string; provider: string }> }
          const hit = (res?.models || []).find((mm) => mm.id === arg || mm.name === arg)
          if (hit) {
            await ipcClient.invoke('model.set', { sessionId: '', provider: hit.provider, modelId: hit.id })
            store.setRunState({ model: `${hit.provider}/${hit.id}` })
            toast.success(i18n.t('composer:toast.modelSet', { model: `${hit.provider}/${hit.id}` }))
          } else {
            toast.error(i18n.t('composer:modelNotFound', { arg }))
          }
        }
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
        await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level: arg })
        store.setRunState({ thinkingLevel: arg })
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
        await ipcClient.invoke('session.compact', { sessionId: '' })
        toast.success(i18n.t('composer:compactedHistory'))
      } catch (e) {
        console.error('/compact failed:', e)
        toast.error('压缩失败')
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
        store.clearTimeline()
        store.setCurrentSession(null)
        store.setHistoryMeta(0, 0, null)
        void ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
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
        toast.error('无法打开 Fork 选择器')
      }
      return true
    }
    case 'clone': {
      try {
        const { cloneCurrentSession } = await import('@renderer/lib/session-fork')
        await cloneCurrentSession()
      } catch (e) {
        console.error('/clone failed:', e)
        toast.error('Clone 失败')
      }
      return true
    }
    case 'review': { setActivePanel('review'); toast.info('已切换到 Review 面板'); return true }
    case 'run': { setActivePanel('run'); toast.info('已切换到 Run 面板'); return true }
    case 'tree': { setActivePanel('tree'); return true }
    case 'settings': { toast.info('请从左侧栏打开设置'); return true }
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