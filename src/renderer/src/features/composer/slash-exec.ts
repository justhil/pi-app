// Slash command execution semantics (A-layer, tui-replacement-and-adapters.md §2.4)
// - builtin (app-native) -> route to dedicated IPC (NOT sent as prompt text) + toast feedback
// - /skill:, /prompt: -> expand then send (sent as prompt text; pi handles slash in message)
// - extension commands -> resolved via slash.resolve, notify/send to pi

import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** App-native builtins handled directly in the renderer (not forwarded as plain prompt text). */
const APP_BUILTIN = new Set([
  'model', 'thinking', 'clear', 'compact', 'new',
  'help', 'settings', 'review', 'run', 'trellis', 'tree', 'skills', 'prompts',
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
          toast.success(`模型已设为 ${provider}/${modelId}`)
        } else {
          const res = await ipcClient.invoke('model.list', {})
          const hit = (res?.models || []).find((mm: any) => mm.id === arg || mm.name === arg)
          if (hit) {
            await ipcClient.invoke('model.set', { sessionId: '', provider: hit.provider, modelId: hit.id })
            store.setRunState({ model: `${hit.provider}/${hit.id}` })
            toast.success(`模型已设为 ${hit.provider}/${hit.id}`)
          } else {
            toast.error(`未找到模型: ${arg}`)
          }
        }
      } catch (e) {
        console.error('/model failed:', e)
        toast.error('切换模型失败')
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
        toast.error(`无效等级: ${arg}（可选 ${THINKING_ORDER.join('/')}）`)
        return true
      }
      try {
        await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level: arg })
        store.setRunState({ thinkingLevel: arg })
        toast.success(`Thinking: ${arg}`)
      } catch (e) {
        console.error('/thinking failed:', e)
        toast.error('切换 thinking 失败')
      }
      return true
    }
    case 'clear': {
      store.clearTimeline()
      toast.success('已清空时间线')
      return true
    }
    case 'compact': {
      try {
        await ipcClient.invoke('session.compact', { sessionId: '' })
        toast.success('已压缩会话历史')
      } catch (e) {
        console.error('/compact failed:', e)
        toast.error('压缩失败')
      }
      return true
    }
    case 'new': {
      try {
        const wid = useUIStore.getState().currentWorkspace
        if (!wid) {
          toast.error('请先打开项目或临时对话分区')
          return true
        }
        const { startNewSession } = await import('@renderer/lib/new-session')
        await startNewSession(wid)
        await ctx.refreshCommands?.()
        toast.success('已新建会话')
      } catch (e) {
        console.error('/new failed:', e)
        toast.error('新建会话失败')
      }
      return true
    }
    case 'review': { setActivePanel('review'); toast.info('已切换到 Review 面板'); return true }
    case 'run': { setActivePanel('run'); toast.info('已切换到 Run 面板'); return true }
    case 'trellis': { setActivePanel('trellis'); toast.info('已切换到 Trellis 面板'); return true }
    case 'tree': { setActivePanel('tree'); return true }
    case 'settings': { toast.info('请从左侧栏打开设置'); return true }
    case 'skills':
    case 'prompts':
    case 'help': {
      toast.info(`/${cmd} 请直接在输入框继续输入查看可用列表`)
      return true
    }
    default:
      return false
  }
}