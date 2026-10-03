import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { commitSessionDisplayMeta } from '@renderer/lib/session-display-meta'
import { formatThinkingChip, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { boundThinkingLevelFor, setModelThinkingBinding } from '@renderer/lib/model-thinking-bindings'
import { useUIStore } from '@renderer/stores/ui-store'

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Next level the current model supports, wrapping around (pi TUI Shift+Tab). */
export function nextThinkingLevel(current: string | undefined, available: readonly string[] | undefined): string {
  const usable = THINKING_LEVELS.filter((l) => !available || available.length === 0 || available.includes(l))
  if (usable.length === 0) return normalizeThinkingLevel(current) ?? 'medium'
  const at = usable.indexOf((normalizeThinkingLevel(current) ?? 'off') as (typeof THINKING_LEVELS)[number])
  return usable[(at + 1) % usable.length]
}

/** Apply a thinking level to the current session (optimistic, rolled back on failure). */
export async function applyThinkingLevel(level: string): Promise<void> {
  const store = useUIStore.getState()
  const previous = store.runState.thinkingLevel
  const model = store.runState.model || ''
  const sessionFile = store.historySessionFile
  store.setRunState({ thinkingLevel: level })
  const bound = boundThinkingLevelFor(model)
  if (bound && model && bound !== level) void setModelThinkingBinding(model, level).catch(() => {})
  try {
    await ipcClient.invoke('thinkingLevel.set', { sessionId: '', sessionFile: sessionFile ?? undefined, level })
    commitSessionDisplayMeta(sessionFile, { thinkingLevel: level })
    toast.success(i18n.t('composer:thinkingPicker.switched', { level: formatThinkingChip(level) }))
  } catch (e) {
    // A draft session has no worker yet; the level is applied when the session starts.
    if (e instanceof Error && e.message.toLowerCase().includes('worker not started')) return
    console.error('thinkingLevel.set failed:', e)
    useUIStore.getState().setRunState({ thinkingLevel: previous })
    toast.error(i18n.t('composer:switchThinkingFailed'))
  }
}
