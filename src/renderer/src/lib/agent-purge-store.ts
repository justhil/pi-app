import { create } from 'zustand'
import {
  DEFAULT_PURGE_STRATEGY,
  defaultAgentPurgeConfig,
  normalizeAgentPurgeConfig,
  normalizePurgeMode,
  normalizePurgedSessionKey,
  normalizePurgedSessionsMap,
  normalizePurgeStrategy,
  personaCopy,
  personaLanguage,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
  type PurgedSessionRecord,
  type PurgeStrategyOptions,
} from '@shared/agent-purge'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'

export interface DraftPurgeSendPayload {
  enabled: boolean
  personaId?: string
  mode?: AgentPurgeMode
  strategy?: PurgeStrategyOptions
}

export type ComposerPurgeUiState = {
  status: 'ready'
  checked: boolean
  disabled: false
  /** True only when the session already has >= 1 turn (or is actively sending/running). First turn is always false (unrestricted). */
  midSession: boolean
  persona: AgentPurgePersona
  personaName: string
  mode: AgentPurgeMode
  strategy: PurgeStrategyOptions
}

interface PendingLock {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
  strategy: PurgeStrategyOptions
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
  draftStrategy: PurgeStrategyOptions | null
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
  draftStrategy: null,
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
  if (cur.pendingLock) {
    useAgentPurgeStore.setState({ draftContextKey: contextKey })
    return
  }
  useAgentPurgeStore.setState({
    draftContextKey: contextKey,
    draftEnabled: false,
    draftPersonaId: null,
    draftMode: null,
    draftStrategy: null,
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

export function setDraftPurgeStrategy(patch: Partial<PurgeStrategyOptions> | null): void {
  if (patch === null) {
    useAgentPurgeStore.setState({ draftStrategy: null })
    return
  }
  const st = useAgentPurgeStore.getState()
  const base = st.draftStrategy ?? st.config.defaultStrategy ?? DEFAULT_PURGE_STRATEGY
  useAgentPurgeStore.setState({
    draftStrategy: normalizePurgeStrategy({ ...base, ...patch }, base),
  })
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
  draftStrategy?: PurgeStrategyOptions | null
  pendingLock: PendingLock | null
}): ComposerPurgeUiState {
  const sessionKey = normalizePurgedSessionKey(input.historySessionFile)
  // First turn is unrestricted whenever zero turns exist in the conversation yet,
  // even if an empty session file has already been materialized.
  const hasPriorTurns =
    input.timelineLength > 0 || Boolean(input.optimisticPendingUserText) || input.isRunning

  const activeRecord = (sessionKey ? input.purgedSessions[sessionKey] : undefined) ?? input.pendingLock
  if (activeRecord) {
    const matched = resolveSelectedDraftPersona(input.config, activeRecord.personaId)
    const persona: AgentPurgePersona =
      matched.id === activeRecord.personaId
        ? matched
        : {
            id: activeRecord.personaId,
            name: activeRecord.personaName,
            description: '',
            body: '',
          }
    return {
      status: 'ready',
      checked: true,
      disabled: false,
      midSession: hasPriorTurns,
      persona,
      personaName: activeRecord.personaName || persona.name,
      mode: activeRecord.mode,
      strategy: normalizePurgeStrategy(activeRecord.strategy, input.config.defaultStrategy),
    }
  }

  const persona = resolveSelectedDraftPersona(input.config, input.draftPersonaId)
  const mode = normalizePurgeMode(input.draftMode ?? input.config.defaultMode, input.config.defaultMode)
  const strategy = normalizePurgeStrategy(
    input.draftStrategy ?? input.config.defaultStrategy,
    input.config.defaultStrategy,
  )
  return {
    status: 'ready',
    checked: !hasPriorTurns && !sessionKey ? input.draftEnabled : false,
    disabled: false,
    midSession: hasPriorTurns,
    persona,
    personaName: persona.name,
    mode,
    strategy,
  }
}

export async function updateSessionPurge(
  sessionFile: string,
  req: {
    enabled: boolean
    personaId?: string
    mode?: AgentPurgeMode
    strategy?: Partial<PurgeStrategyOptions>
  },
): Promise<void> {
  const key = normalizePurgedSessionKey(sessionFile)
  if (!key) return
  const st = useAgentPurgeStore.getState()
  const prevRec = st.purgedSessions[key]

  if (!req.enabled) {
    const next = { ...st.purgedSessions }
    delete next[key]
    useAgentPurgeStore.setState({ pendingLock: null, purgedSessions: next })
  } else {
    const persona = resolveSelectedDraftPersona(
      st.config,
      req.personaId ?? prevRec?.personaId ?? st.draftPersonaId,
    )
    const mode = normalizePurgeMode(
      req.mode ?? prevRec?.mode ?? st.draftMode ?? st.config.defaultMode,
      st.config.defaultMode,
    )
    const baseStrategy = prevRec?.strategy ?? st.draftStrategy ?? st.config.defaultStrategy
    const nextStrategy = req.strategy
      ? normalizePurgeStrategy({ ...baseStrategy, ...req.strategy }, baseStrategy)
      : normalizePurgeStrategy(baseStrategy, st.config.defaultStrategy)
    const copy = personaCopy(persona, personaLanguage(i18n.language))

    useAgentPurgeStore.setState({
      pendingLock: null,
      draftPersonaId: persona.id,
      draftMode: mode,
      draftStrategy: nextStrategy,
      purgedSessions: {
        ...st.purgedSessions,
        [key]: {
          personaId: persona.id,
          personaName: copy.name,
          mode,
          body: copy.body || 'active',
          ...(copy.primerTurns ? { primerTurns: copy.primerTurns } : {}),
          strategy: nextStrategy,
          lockedAt: prevRec?.lockedAt || Date.now(),
        },
      },
    })
  }
  try {
    const res = (await ipcClient.invoke('purge.setSession', {
      sessionFile,
      enabled: req.enabled,
      ...(req.personaId ? { personaId: req.personaId } : {}),
      ...(req.mode ? { mode: req.mode } : {}),
      ...(req.strategy ? { strategy: req.strategy } : {}),
    })) as { purgedSessions?: unknown } | undefined
    if (res?.purgedSessions !== undefined) {
      useAgentPurgeStore.setState({
        purgedSessions: normalizePurgedSessionsMap(res.purgedSessions),
      })
    }
  } catch {
    void loadAgentPurgeState(true)
  }
}

/**
 * Snapshot the draft's Purge switch right when the user sends the first message of a new chat.
 */
export function consumeDraftPurgeForFirstSend(isFirstTurnOfNewChat: boolean): DraftPurgeSendPayload | undefined {
  if (!isFirstTurnOfNewChat) return undefined
  const st = useAgentPurgeStore.getState()
  if (!st.draftEnabled) return undefined
  const persona = resolveSelectedDraftPersona(st.config, st.draftPersonaId)
  const mode = normalizePurgeMode(st.draftMode ?? st.config.defaultMode, st.config.defaultMode)
  const strategy = normalizePurgeStrategy(
    st.draftStrategy ?? st.config.defaultStrategy,
    st.config.defaultStrategy,
  )
  const copy = personaCopy(persona, personaLanguage(i18n.language))
  useAgentPurgeStore.setState({
    draftEnabled: false,
    pendingLock: {
      personaId: persona.id,
      personaName: copy.name,
      mode,
      strategy,
    },
  })
  return {
    enabled: true,
    personaId: persona.id,
    mode,
    strategy,
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
  confirmed?: {
    personaId: string
    personaName: string
    mode: AgentPurgeMode
    strategy?: PurgeStrategyOptions
  },
): void {
  const st = useAgentPurgeStore.getState()
  const key = normalizePurgedSessionKey(sessionFile)
  const meta = confirmed ?? st.pendingLock
  if (!key || !meta) {
    if (st.pendingLock) useAgentPurgeStore.setState({ pendingLock: null })
    return
  }
  const persona = st.config.personas.find((p) => p.id === meta.personaId)
  const localized = persona ? personaCopy(persona, personaLanguage(i18n.language)) : null
  useAgentPurgeStore.setState({
    pendingLock: null,
    purgedSessions: {
      ...st.purgedSessions,
      [key]: {
        personaId: meta.personaId,
        personaName: localized?.name || meta.personaName,
        mode: meta.mode,
        body: localized?.body || 'locked',
        ...(localized?.primerTurns ? { primerTurns: localized.primerTurns } : {}),
        strategy: normalizePurgeStrategy(meta.strategy, st.config.defaultStrategy),
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
      [to]: { ...record, strategy: { ...record.strategy }, lockedAt: Date.now() },
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
