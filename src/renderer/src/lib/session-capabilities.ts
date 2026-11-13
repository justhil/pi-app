import { create } from 'zustand'
import { sessionHasBrowserTabs } from '@shared/browser-types'
import { normalizeCapabilities, type CapabilityId } from '@shared/capabilities'
import { browserActions, useBrowserStore } from '@renderer/features/browser/browser-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

/** Unsaved composer (new chat / draft): its switches move to the session file once it exists. */
export const DRAFT_CAPABILITY_KEY = '\u0000draft'
const MAX_REMEMBERED = 300

interface SessionCapabilitiesState {
  byKey: Record<string, CapabilityId[]>
  loaded: boolean
}

export const useSessionCapabilitiesStore = create<SessionCapabilitiesState>(() => ({ byKey: {}, loaded: false }))

export function capabilityKey(sessionFile: string | null | undefined): string {
  return (sessionFile && (normalizeSessionFileKey(sessionFile) || sessionFile)) || DRAFT_CAPABILITY_KEY
}

let loading: Promise<void> | null = null
export function loadSessionCapabilities(): Promise<void> {
  if (!loading) {
    loading = ipcClient
      .invoke('settings.get', { key: 'sessionCapabilities' })
      .then((res: { settings?: { sessionCapabilities?: Record<string, unknown> } } | undefined) => {
        const raw = res?.settings?.sessionCapabilities ?? {}
        const byKey: Record<string, CapabilityId[]> = {}
        for (const [k, v] of Object.entries(raw)) {
          const caps = normalizeCapabilities(v)
          if (caps.length) byKey[k] = caps
        }
        useSessionCapabilitiesStore.setState((s) => ({ byKey: { ...byKey, ...s.byKey }, loaded: true }))
      })
      .catch(() => useSessionCapabilitiesStore.setState({ loaded: true }))
  }
  return loading
}

/** Settings changed outside this window (a paired phone): take the stored map, keep the draft. */
export async function reloadSessionCapabilities(): Promise<void> {
  try {
    const res = (await ipcClient.invoke('settings.get', { key: 'sessionCapabilities' })) as
      | { settings?: { sessionCapabilities?: Record<string, unknown> } }
      | undefined
    const raw = res?.settings?.sessionCapabilities ?? {}
    const byKey: Record<string, CapabilityId[]> = {}
    for (const [k, v] of Object.entries(raw)) {
      const caps = normalizeCapabilities(v)
      if (caps.length) byKey[k] = caps
    }
    const draft = useSessionCapabilitiesStore.getState().byKey[DRAFT_CAPABILITY_KEY]
    if (draft?.length) byKey[DRAFT_CAPABILITY_KEY] = draft
    useSessionCapabilitiesStore.setState({ byKey, loaded: true })
  } catch {
    /* keep the current map */
  }
}

function persist(byKey: Record<string, CapabilityId[]>): void {
  // Only saved sessions are remembered across restarts; drafts live in memory.
  const entries = Object.entries(byKey).filter(([k, v]) => k !== DRAFT_CAPABILITY_KEY && v.length > 0)
  const value = Object.fromEntries(entries.slice(-MAX_REMEMBERED))
  void ipcClient.invoke('settings.set', { key: 'sessionCapabilities', value }).catch(() => {})
}

/** Pure: new map with `id` switched on/off for `key` (empty lists are dropped = default off). */
export function toggleCapabilityIn(
  byKey: Record<string, CapabilityId[]>,
  key: string,
  id: CapabilityId,
  on: boolean,
): Record<string, CapabilityId[]> {
  const current = byKey[key] ?? []
  const next = on ? (current.includes(id) ? current : [...current, id]) : current.filter((c) => c !== id)
  const out = { ...byKey }
  if (next.length) out[key] = next
  else delete out[key]
  return out
}

/** Pure: carry a draft's switches over to the session file it just became (if that has none). */
export function adoptDraftCapabilities(byKey: Record<string, CapabilityId[]>, sessionKey: string): Record<string, CapabilityId[]> | null {
  const draft = byKey[DRAFT_CAPABILITY_KEY]
  if (!draft?.length || sessionKey === DRAFT_CAPABILITY_KEY || byKey[sessionKey]?.length) return null
  const out = { ...byKey, [sessionKey]: draft }
  delete out[DRAFT_CAPABILITY_KEY]
  return out
}

/** Sessions where the user explicitly clicked "Off" for browser control (do not auto-enable). */
const browserExplicitlyOff = new Set<string>()

export function setSessionCapability(sessionFile: string | null | undefined, id: CapabilityId, on: boolean): void {
  const key = capabilityKey(sessionFile)
  const byKey = toggleCapabilityIn(useSessionCapabilitiesStore.getState().byKey, key, id, on)
  if (id === 'browser' || id === 'chrome') {
    const next = byKey[key] ?? []
    if (on) browserExplicitlyOff.delete(key)
    else if (!next.includes('browser') && !next.includes('chrome')) browserExplicitlyOff.add(key)
  }
  useSessionCapabilitiesStore.setState({ byKey })
  persist(byKey)
}

/** Auto-mount built-in browser tools when the conversation already has browser tabs open. */
export function withAutoBrowserCapability(base: readonly CapabilityId[], sessionKey: string): CapabilityId[] {
  if (base.includes('browser') || base.includes('chrome') || browserExplicitlyOff.has(sessionKey)) {
    return [...base]
  }
  const tabs = Object.values(useBrowserStore.getState().tabs)
  if (tabs.length > 0 && sessionHasBrowserTabs(tabs, sessionKey)) {
    return [...base, 'browser']
  }
  return [...base]
}

let lastDraftSendAt = 0
/** A draft that sent within this window and then got a session file is that session. */
const DRAFT_ADOPT_WINDOW_MS = 15_000

/** Capabilities to send with the next message of the session currently in the composer. */
export function currentSessionCapabilities(): CapabilityId[] {
  const key = capabilityKey(useUIStore.getState().historySessionFile)
  if (key === DRAFT_CAPABILITY_KEY) {
    lastDraftSendAt = Date.now()
    return withAutoBrowserCapability(useSessionCapabilitiesStore.getState().byKey[key] ?? [], key)
  }
  // Sending a new chat creates its session file before the prompt goes out: the draft's switches
  // and any draft browser tabs belong to it.
  if (Date.now() - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const draftTabs = Object.values(useBrowserStore.getState().tabs)
    if (sessionHasBrowserTabs(draftTabs, DRAFT_CAPABILITY_KEY)) {
      void browserActions.adoptSession(DRAFT_CAPABILITY_KEY, key).catch(() => {})
    }
  }
  const { byKey } = useSessionCapabilitiesStore.getState()
  const adopted = adoptDraftCapabilities(byKey, key)
  if (adopted) {
    useSessionCapabilitiesStore.setState({ byKey: adopted })
    persist(adopted)
    return withAutoBrowserCapability(adopted[key], key)
  }
  return withAutoBrowserCapability(byKey[key] ?? [], key)
}

/**
 * Composer switched from `prevKey` to `nextKey`. A fresh draft starts with everything off; a draft
 * that was just sent keeps its switches under the session file it became; otherwise draft
 * switches are dropped (switching to an unrelated session must not inherit them).
 */
export function onCapabilityKeyChange(prevKey: string, nextKey: string, now = Date.now()): void {
  if (prevKey === nextKey) return
  if (prevKey === DRAFT_CAPABILITY_KEY && now - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const draftTabs = Object.values(useBrowserStore.getState().tabs)
    if (sessionHasBrowserTabs(draftTabs, DRAFT_CAPABILITY_KEY)) {
      void browserActions.adoptSession(DRAFT_CAPABILITY_KEY, nextKey).catch(() => {})
    }
  }
  const { byKey } = useSessionCapabilitiesStore.getState()
  if (!byKey[DRAFT_CAPABILITY_KEY]) return
  if (prevKey === DRAFT_CAPABILITY_KEY && now - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const adopted = adoptDraftCapabilities(byKey, nextKey)
    if (adopted) {
      useSessionCapabilitiesStore.setState({ byKey: adopted })
      persist(adopted)
      return
    }
  }
  const out = { ...byKey }
  delete out[DRAFT_CAPABILITY_KEY]
  useSessionCapabilitiesStore.setState({ byKey: out })
}
