import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  reduceSessionAttention,
  type SessionAttention,
} from '@renderer/lib/session-attention'
import type { UIState } from '@renderer/stores/ui-store-types'

type StoreSet = (
  patch: Partial<UIState> | ((state: UIState) => Partial<UIState> | UIState),
) => void

type RuntimeSlice = Pick<
  UIState,
  | 'sessionRuntimeRunning'
  | 'sessionWaitingUi'
  | 'sessionSettledUnseen'
  | 'sessionAttention'
  | 'setSessionRuntimeRunning'
  | 'setSessionWaitingUi'
  | 'markSessionSettled'
  | 'markSessionViewed'
  | 'reconcileSessionRuntimeIdle'
>

function runtimeKey(sessionFile: string): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

function withoutSessionFlag(
  flags: Record<string, boolean>,
  sessionFile: string,
): Record<string, boolean> {
  const key = runtimeKey(sessionFile)
  const next = { ...flags }
  for (const existing of Object.keys(next)) {
    if (normalizeSessionFileKey(existing) === key) delete next[existing]
  }
  return next
}

function flagOn(flags: Record<string, boolean> | undefined, sessionFile: string): boolean {
  if (!flags) return false
  const key = runtimeKey(sessionFile)
  if (flags[key] === true || flags[sessionFile] === true) return true
  return Object.entries(flags).some(
    ([existing, on]) => on && sessionFilesEqual(existing, sessionFile),
  )
}

function dropAttentionKey(
  attention: Record<string, SessionAttention>,
  sessionFile: string,
): Record<string, SessionAttention> {
  const key = runtimeKey(sessionFile)
  const next = { ...attention }
  for (const existing of Object.keys(next)) {
    if (normalizeSessionFileKey(existing) === key) delete next[existing]
  }
  return next
}

function projectAttention(
  state: Pick<
    UIState,
    | 'sessionRuntimeRunning'
    | 'sessionWaitingUi'
    | 'sessionSettledUnseen'
    | 'historySessionFile'
    | 'sessionAttention'
  >,
  sessionFile: string,
): Record<string, SessionAttention> {
  const key = runtimeKey(sessionFile)
  const next = dropAttentionKey(state.sessionAttention || {}, sessionFile)
  const value = reduceSessionAttention({
    running: flagOn(state.sessionRuntimeRunning || {}, sessionFile),
    waitingUi: flagOn(state.sessionWaitingUi || {}, sessionFile),
    settledUnseen: flagOn(state.sessionSettledUnseen || {}, sessionFile),
    viewing: sessionFilesEqual(state.historySessionFile, sessionFile),
  })
  if (value !== 'idle') next[key] = value
  return next
}

export function createRuntimeSlice(set: StoreSet): RuntimeSlice {
  return {
    sessionRuntimeRunning: {},
    sessionWaitingUi: {},
    sessionSettledUnseen: {},
    sessionAttention: {},
    setSessionRuntimeRunning: (sessionFile, running) =>
      set((state) => {
        const key = runtimeKey(sessionFile)
        if (!key) return state
        const sessionRuntimeRunning = withoutSessionFlag(state.sessionRuntimeRunning || {}, sessionFile)
        if (running) sessionRuntimeRunning[key] = true
        const next = { ...state, sessionRuntimeRunning }
        return {
          sessionRuntimeRunning,
          sessionAttention: projectAttention(next, sessionFile),
        }
      }),
    setSessionWaitingUi: (sessionFile, waiting) =>
      set((state) => {
        const key = runtimeKey(sessionFile)
        if (!key) return state
        const sessionWaitingUi = withoutSessionFlag(state.sessionWaitingUi || {}, sessionFile)
        if (waiting) sessionWaitingUi[key] = true
        const next = { ...state, sessionWaitingUi }
        return {
          sessionWaitingUi,
          sessionAttention: projectAttention(next, sessionFile),
        }
      }),
    markSessionSettled: (sessionFile) =>
      set((state) => {
        const key = runtimeKey(sessionFile)
        if (!key) return state
        const viewing = sessionFilesEqual(state.historySessionFile, sessionFile)
        const sessionSettledUnseen = withoutSessionFlag(state.sessionSettledUnseen || {}, sessionFile)
        if (!viewing) sessionSettledUnseen[key] = true
        const next = { ...state, sessionSettledUnseen }
        return {
          sessionSettledUnseen,
          sessionAttention: projectAttention(next, sessionFile),
        }
      }),
    markSessionViewed: (sessionFile) =>
      set((state) => {
        const key = runtimeKey(sessionFile)
        if (!key) return state
        const sessionSettledUnseen = withoutSessionFlag(state.sessionSettledUnseen || {}, sessionFile)
        const next = { ...state, sessionSettledUnseen }
        return {
          sessionSettledUnseen,
          sessionAttention: projectAttention(next, sessionFile),
        }
      }),
    reconcileSessionRuntimeIdle: (sessionFile) =>
      set((state) => {
        const sessionRuntimeRunning = withoutSessionFlag(state.sessionRuntimeRunning || {}, sessionFile)
        const nextState = { ...state, sessionRuntimeRunning }
        const sessionAttention = projectAttention(nextState, sessionFile)
        if (!sessionFilesEqual(state.historySessionFile, sessionFile)) {
          return { sessionRuntimeRunning, sessionAttention }
        }
        return {
          sessionRuntimeRunning,
          sessionAttention,
          streamingAssistantId: null,
          optimisticPendingUserText: null,
          agentTurnBootstrapping: false,
        }
      }),
  }
}
