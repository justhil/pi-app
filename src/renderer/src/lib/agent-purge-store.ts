import { create } from 'zustand'
import {
  defaultAgentPurgeConfig,
  normalizeAgentPurgeConfig,
  normalizePurgeMode,
  normalizePurgedSessionKey,
  normalizePurgedSessionsMap,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
  type PurgedSessionRecord,
} from '@shared/agent-purge'
import { ipcClient } from '@renderer/lib/ipc-client'

export interface DraftPurgeSendPayload {
  enabled: boolean
  personaId?: string
  mode?: AgentPurgeMode
}

export type ComposerPurgeUiState =
  | {
      status: 'draft'
      checked: boolean
      disabled: false
      persona: AgentPurgePersona
      mode: AgentPurgeMode
    }
  | {
      status: 'locked-on'
      checked: true
      disabled: true
      personaName: string
      personaId: string
      mode: AgentPurgeMode
    }
  | {
      status: 'locked-off'
      checked: false
      disabled: true
    }

interface PendingLock {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
}

interface AgentPurgeStoreState {
  loaded: boolean
  config: AgentPurgeConfig
  purgedSessions: Record<string, PurgedSessionRecord>
  localDir: string
  draftContextKey: string | null
  draftEnabled: boolean
  draftPersonaId: string | null
  draftMode: AgentPurgeMode | null
  pendingLock: PendingLock | null
}

export const useAgentPurgeStore = create<AgentPurgeStoreState>(() => ({
  loaded: false,
  config: defaultAgentPurgeConfig(),
  purgedSessions: {},
  localDir: '',
  draftContextKey: null,
  draftEnabled: false,
  draftPersonaId: null,
  draftMode: null,
  pendingLock: null,
}))

let loadInFlight: Promise<void> | null = null

export function loadAgentPurgeState(force = false): Promise<void> {
  if (!force && useAgentPurgeStore.getState().loaded) return Promise.resolve()
  if (loadInFlight && !force) return loadInFlight
  loadInFlight = ipcClient
    .invoke('purge.getState')
    .then((res: { config?: unknown; purgedSessions?: unknown; localDir?: string } | undefined) => {
      useAgentPurgeStore.setState({
        loaded: true,
        config: normalizeAgentPurgeConfig(res?.config),
        purgedSessions: normalizePurgedSessionsMap(res?.purgedSessions),
        localDir: typeof res?.localDir === 'string' ? res.localDir : '',
      })
    })
    .catch(() => {
      useAgentPurgeStore.setState({ loaded: true })
    })
    .finally(() => {
      loadInFlight = null
    })
  return loadInFlight
}

export function applySavedAgentPurgeConfig(raw: unknown): AgentPurgeConfig {
  const config = normalizeAgentPurgeConfig(raw)
  useAgentPurgeStore.setState({ config, loaded: true })
  return config
}

/** Reset draft toggle to OFF whenever entering a different conversation / new blank chat. */
export function syncPurgeDraftContextKey(contextKey: string): void {
  const cur = useAgentPurgeStore.getState()
  if (cur.draftContextKey === contextKey) return
  // Keep pendingLock while the newly materialized session is finishing its first send
  if (cur.pendingLock) {
    useAgentPurgeStore.setState({ draftContextKey: contextKey })
    return
  }
  useAgentPurgeStore.setState({
    draftContextKey: contextKey,
    draftEnabled: false,
    draftPersonaId: null,
    draftMode: null,
  })
}

export function setDraftPurgeEnabled(enabled: boolean): void {
  useAgentPurgeStore.setState({ draftEnabled: enabled })
}

export function setDraftPurgePersona(personaId: string | null): void {
  useAgentPurgeStore.setState({ draftPersonaId: personaId })
}

export function setDraftPurgeMode(mode: AgentPurgeMode | null): void {
  useAgentPurgeStore.setState({ draftMode: mode })
}

export function resolveSelectedDraftPersona(
  config: AgentPurgeConfig,
  draftPersonaId: string | null,
): AgentPurgePersona {
  return (
    (draftPersonaId ? config.personas.find((p) => p.id === draftPersonaId) : undefined) ??
    config.personas.find((p) => p.id === config.defaultPersonaId) ??
    config.personas[0] ?? {
      id: 'default',
      name: 'Purge',
      description: '',
      body: '',
    }
  )
}

export function resolveComposerPurgeState(input: {
  historySessionFile: string | null | undefined
  timelineLength: number
  optimisticPendingUserText: string | null | undefined
  isRunning: boolean
  config: AgentPurgeConfig
  purgedSessions: Record<string, PurgedSessionRecord>
  draftEnabled: boolean
  draftPersonaId: string | null
  draftMode: AgentPurgeMode | null
  pendingLock: PendingLock | null
}): ComposerPurgeUiState {
  const sessionKey = normalizePurgedSessionKey(input.historySessionFile)
  const lockedRecord = sessionKey ? input.purgedSessions[sessionKey] : undefined
  if (lockedRecord) {
    return {
      status: 'locked-on',
      checked: true,
      disabled: true,
      personaName: lockedRecord.personaName,
      personaId: lockedRecord.personaId,
      mode: lockedRecord.mode,
    }
  }
  if (input.pendingLock) {
    return {
      status: 'locked-on',
      checked: true,
      disabled: true,
      personaName: input.pendingLock.personaName,
      personaId: input.pendingLock.personaId,
      mode: input.pendingLock.mode,
    }
  }

  const isBrandNewChat =
    !sessionKey &&
    input.timelineLength === 0 &&
    !input.optimisticPendingUserText &&
    !input.isRunning

  if (!isBrandNewChat) {
    return {
      status: 'locked-off',
      checked: false,
      disabled: true,
    }
  }

  const persona = resolveSelectedDraftPersona(input.config, input.draftPersonaId)
  const mode = normalizePurgeMode(input.draftMode ?? input.config.defaultMode, input.config.defaultMode)
  return {
    status: 'draft',
    checked: input.draftEnabled,
    disabled: false,
    persona,
    mode,
  }
}

/**
 * Snapshot the draft's Purge switch right when the user sends the first message of a new chat.
 * Immediately flips the UI into `locked-on` (via `pendingLock`) so the switch greys out on send.
 */
export function consumeDraftPurgeForFirstSend(isFirstTurnOfNewChat: boolean): DraftPurgeSendPayload | undefined {
  if (!isFirstTurnOfNewChat) return undefined
  const st = useAgentPurgeStore.getState()
  if (!st.draftEnabled) return undefined
  const persona = resolveSelectedDraftPersona(st.config, st.draftPersonaId)
  const mode = normalizePurgeMode(st.draftMode ?? st.config.defaultMode, st.config.defaultMode)
  useAgentPurgeStore.setState({
    draftEnabled: false,
    pendingLock: {
      personaId: persona.id,
      personaName: persona.name,
      mode,
    },
  })
  return {
    enabled: true,
    personaId: persona.id,
    mode,
  }
}

export function rollbackDraftPurgeAfterSendFailure(payload: DraftPurgeSendPayload | undefined): void {
  if (!payload?.enabled) return
  useAgentPurgeStore.setState({
    draftEnabled: true,
    pendingLock: null,
  })
}

export function commitPurgedSessionAfterSend(
  sessionFile: string | undefined,
  confirmed?: { personaId: string; personaName: string; mode: AgentPurgeMode },
): void {
  const st = useAgentPurgeStore.getState()
  const key = normalizePurgedSessionKey(sessionFile)
  const meta = confirmed ?? st.pendingLock
  if (!key || !meta) {
    if (st.pendingLock) useAgentPurgeStore.setState({ pendingLock: null })
    return
  }
  const persona = st.config.personas.find((p) => p.id === meta.personaId)
  useAgentPurgeStore.setState({
    pendingLock: null,
    purgedSessions: {
      ...st.purgedSessions,
      [key]: {
        personaId: meta.personaId,
        personaName: meta.personaName,
        mode: meta.mode,
        body: persona?.body || 'locked',
        lockedAt: Date.now(),
      },
    },
  })
}

export function inheritPurgedSessionInStore(
  fromSessionFile: string | undefined,
  toSessionFile: string | undefined,
): void {
  const from = normalizePurgedSessionKey(fromSessionFile)
  const to = normalizePurgedSessionKey(toSessionFile)
  if (!from || !to || from === to) return
  const st = useAgentPurgeStore.getState()
  const record = st.purgedSessions[from]
  if (!record || st.purgedSessions[to]) return
  useAgentPurgeStore.setState({
    purgedSessions: {
      ...st.purgedSessions,
      [to]: { ...record, lockedAt: Date.now() },
    },
  })
}

let pendingOpenSettingsPage: string | null = null
export function consumePendingSettingsPage(): string | null {
  const next = pendingOpenSettingsPage
  pendingOpenSettingsPage = null
  return next
}

export function openSettingsToPage(page: string): void {
  pendingOpenSettingsPage = page
  window.dispatchEvent(new CustomEvent('pi-desktop:open-settings-page', { detail: { page } }))
}
