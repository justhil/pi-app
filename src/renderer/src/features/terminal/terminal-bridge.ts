import { ipcClient } from '@renderer/lib/ipc-client'
import { terminalActions, useTerminalStore, type ShellProfile, type TerminalPaneState } from './terminal-store'

type Writer = (data: string) => void

/** pty output per id; output that arrives before its pane mounted is held until it does. */
const writers = new Map<string, Writer>()
const pending = new Map<string, string[]>()
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  window.piDesktop?.onTerminalData?.(({ id, data }) => {
    const w = writers.get(id)
    if (w) w(data)
    else pending.set(id, [...(pending.get(id) ?? []), data])
  })
  window.piDesktop?.onTerminalExit?.(({ id, code }) => terminalActions.markExited(id, code))
}

export function attachWriter(id: string, w: Writer): () => void {
  wire()
  writers.set(id, w)
  for (const chunk of pending.get(id) ?? []) w(chunk)
  pending.delete(id)
  return () => {
    if (writers.get(id) === w) writers.delete(id)
  }
}

export function writeToPty(id: string, data: string): void {
  window.piDesktop?.terminalWrite?.(id, data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  void ipcClient.invoke('terminal.resize', { id, cols, rows }).catch(() => {})
}

export async function loadProfiles(refresh = false): Promise<ShellProfile[]> {
  const cached = useTerminalStore.getState().profiles
  if (cached && !refresh) return cached
  const r = (await ipcClient.invoke('terminal.profiles', { refresh })) as { profiles?: ShellProfile[] }
  const profiles = r?.profiles ?? []
  terminalActions.setProfiles(profiles)
  return profiles
}

/** Spawn a shell (default: pi's own) in `cwd`; the pane sizes it on mount. */
export async function spawnPane(profileId: string | undefined, cwd: string | undefined): Promise<TerminalPaneState | { error: string }> {
  wire()
  const r = (await ipcClient.invoke('terminal.create', { profileId, cwd, cols: 100, rows: 24 })) as { ok: boolean; id?: string; profile?: ShellProfile; error?: string }
  if (!r?.ok || !r.id || !r.profile) return { error: r?.error || 'spawn failed' }
  return { ptyId: r.id, profile: r.profile }
}

export function killPty(id: string): void {
  writers.delete(id)
  pending.delete(id)
  void ipcClient.invoke('terminal.kill', { id }).catch(() => {})
}

/** Quote a path for the shell it is typed into (WSL sees Windows drives under /mnt). */
export function shellPath(path: string, kind: string): string {
  if (kind === 'wsl') {
    const m = /^([a-zA-Z]):[\\/](.*)$/.exec(path)
    if (m) path = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
  }
  if (kind === 'cmd' || kind === 'pwsh' || kind === 'powershell') return `"${path.replace(/"/g, '""')}"`
  return `'${path.replace(/'/g, `'\\''`)}'`
}
