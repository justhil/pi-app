import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import { ipcClient } from '@renderer/lib/ipc-client'
import { terminalActions, useTerminalStore } from './terminal-store'
import { stopBackgroundTaskLogFollower } from './background-task-terminal'

export type TerminalInstance = { term: Terminal; host: HTMLDivElement; fit: FitAddon; search: SearchAddon; dispose: () => void }

/**
 * xterm instances outlive their React pane: a terminal cannot be re-opened into a new element,
 * so each pty's terminal lives in its own host div that panes move in and out of the DOM.
 *
 * This registry only holds them (types only from xterm), so the drawer can stay in the app shell
 * while xterm itself loads with the first pane (see terminal-pane.tsx).
 */
const instances = new Map<string, TerminalInstance>()
const registrationListeners = new Set<(ptyId: string) => void>()

export function getTerminalInstance(ptyId: string): TerminalInstance | undefined {
  return instances.get(ptyId)
}

export function registerTerminalInstance(ptyId: string, instance: TerminalInstance): void {
  instances.set(ptyId, instance)
  for (const listener of [...registrationListeners]) listener(ptyId)
}

export function disposeTerminalInstance(ptyId: string): void {
  instances.get(ptyId)?.dispose()
  instances.delete(ptyId)
}

export function terminalSelection(ptyId: string): string {
  return instances.get(ptyId)?.term.getSelection() ?? ''
}

/** Follows a pane's selection; a pane whose terminal is still loading is picked up once it exists. */
export function onTerminalSelection(ptyId: string, cb: (has: boolean) => void): () => void {
  let detach: (() => void) | null = null
  const attach = (): boolean => {
    const inst = instances.get(ptyId)
    if (!inst) return false
    const d = inst.term.onSelectionChange(() => cb(inst.term.hasSelection()))
    detach = () => d.dispose()
    return true
  }
  if (attach()) return () => detach?.()
  const onRegistered = (id: string) => {
    if (id === ptyId && attach()) registrationListeners.delete(onRegistered)
  }
  registrationListeners.add(onRegistered)
  return () => {
    registrationListeners.delete(onRegistered)
    detach?.()
  }
}

/** Kill-and-forget a pane's process and terminal (closing its tab or pane). */
function closePaneNow(ptyId: string): void {
  const pane = useTerminalStore.getState().tabs.flatMap((t) => t.panes).find((p) => p.ptyId === ptyId)
  terminalActions.closePane(ptyId)
  disposeTerminalInstance(ptyId)
  // A background task's log pane has no process of its own: stop following its log instead.
  if (pane?.backgroundTask) {
    stopBackgroundTaskLogFollower(ptyId)
    return
  }
  if (pane && pane.exited === undefined) void ipcClient.invoke('terminal.kill', { id: ptyId }).catch(() => {})
}

export function useClosePane(): (ptyId: string) => void {
  return closePaneNow
}
