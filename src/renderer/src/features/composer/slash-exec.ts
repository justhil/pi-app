// Slash command execution semantics (A-layer, tui-replacement-and-adapters.md §2.4)
// - builtin (app-native) -> route to dedicated IPC (NOT sent as prompt text)
// - /skill:, /prompt: -> expand then send (sent as prompt text for now; expansion hook reserved)
// - extension commands -> sent as prompt text so pi can dispatch (pi handles slash in message)

import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** Built-in commands handled directly in the app, not forwarded as plain prompt text. */
const APP_BUILTIN = new Set(['model', 'thinking', 'clear', 'compact', 'new'])

export function isExecutableBuiltin(input: string): boolean {
  const m = input.match(/^\/(\w+)/)
  return !!m && APP_BUILTIN.has(m[1])
}

export interface SlashExecContext {
  refreshCommands?: () => Promise<void>
}

/**
 * Resolve the first token of the input. Returns the command name (with leading /) or null.
 */
function firstToken(input: string): string | null {
  const m = input.match(/^(\/\S+)/)
  return m ? m[1] : null
}

/**
 * Execute an app-native slash command. Returns true if handled (sender should clear input).
 * Returns false to let the caller send the text as a regular prompt.
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

  switch (cmd) {
    case 'model': {
      // No arg -> cycle to next; with arg -> set by provider/modelId (best effort)
      try {
        if (!arg) {
          await ipcClient.invoke('model.cycle', {})
        } else {
          // arg forms: "provider/modelId" or just "modelId"
          const slash = arg.includes('/')
          if (slash) {
            const [provider, modelId] = arg.split('/')
            await ipcClient.invoke('model.set', { sessionId: '', provider, modelId })
          } else {
            // Try to resolve via model.list
            const res = await ipcClient.invoke('model.list', {})
            const hit = (res?.models || []).find((mm: any) => mm.id === arg || mm.name === arg)
            if (hit) {
              await ipcClient.invoke('model.set', { sessionId: '', provider: hit.provider, modelId: hit.id })
            }
          }
        }
      } catch (e) {
        console.error('/model failed:', e)
      }
      return true
    }
    case 'thinking': {
      // arg in {off,minimal,low,medium,high,xhigh}; empty -> cycle not exposed, default medium
      const level = (arg || 'medium') as any
      try {
        await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level })
      } catch (e) {
        console.error('/thinking failed:', e)
      }
      return true
    }
    case 'clear': {
      store.clearTimeline()
      return true
    }
    case 'compact': {
      try {
        await ipcClient.invoke('session.compact', { sessionId: '' })
      } catch (e) {
        console.error('/compact failed:', e)
      }
      return true
    }
    case 'new': {
      try {
        await ipcClient.invoke('session.new', { workspaceId: '', title: arg || undefined })
        await ctx.refreshCommands?.()
      } catch (e) {
        console.error('/new failed:', e)
      }
      return true
    }
    default:
      return false
  }
}