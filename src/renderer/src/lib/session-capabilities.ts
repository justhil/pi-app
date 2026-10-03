import { create } from 'zustand'
import { normalizeCapabilities, type CapabilityId } from '@shared/capabilities'
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

export function setSessionCapability(sessionFile: string | null | undefined, id: CapabilityId, on: boolean): void {
  const byKey = toggleCapabilityIn(useSessionCapabilitiesStore.getState().byKey, capabilityKey(sessionFile), id, on)
  useSessionCapabilitiesStore.setState({ byKey })
  persist(byKey)
}

let lastDraftSendAt = 0
/** A draft that sent within this window and then got a session file is that session. */
const DRAFT_ADOPT_WINDOW_MS = 15_000

/** Capabilities to send with the next message of the session currently in the composer. */
export function currentSessionCapabilities(): CapabilityId[] {
  const key = capabilityKey(useUIStore.getState().historySessionFile)
  if (key === DRAFT_CAPABILITY_KEY) {
    lastDraftSendAt = Date.now()
    return useSessionCapabilitiesStore.getState().byKey[key] ?? []
  }
  // Sending a new chat creates its session file before the prompt goes out: the draft's switches
  // belong to it. (Switching to another session already dropped them, so this is that draft.)
  const { byKey } = useSessionCapabilitiesStore.getState()
  const adopted = adoptDraftCapabilities(byKey, key)
  if (adopted) {
    useSessionCapabilitiesStore.setState({ byKey: adopted })
    persist(adopted)
    return adopted[key]
  }
  return byKey[key] ?? []
}

/**
 * Composer switched from `prevKey` to `nextKey`. A fresh draft starts with everything off; a draft
 * that was just sent keeps its switches under the session file it became; otherwise draft
 * switches are dropped (switching to an unrelated session must not inherit them).
 */
export function onCapabilityKeyChange(prevKey: string, nextKey: string, now = Date.now()): void {
  if (prevKey === nextKey) return
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
