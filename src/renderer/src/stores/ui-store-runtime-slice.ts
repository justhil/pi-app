import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { UIState } from '@renderer/stores/ui-store-types'

type StoreSet = (
  patch: Partial<UIState> | ((state: UIState) => Partial<UIState> | UIState),
) => void

type RuntimeSlice = Pick<
  UIState,
  'sessionRuntimeRunning' | 'setSessionRuntimeRunning' | 'reconcileSessionRuntimeIdle'
>

function runtimeKey(sessionFile: string): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

function withoutSessionRuntime(
  runtime: Record<string, boolean>,
  sessionFile: string,
): Record<string, boolean> {
  const key = runtimeKey(sessionFile)
  const next = { ...runtime }
  for (const existing of Object.keys(next)) {
    if (normalizeSessionFileKey(existing) === key) delete next[existing]
  }
  return next
}

export function createRuntimeSlice(set: StoreSet): RuntimeSlice {
  return {
    sessionRuntimeRunning: {},
    setSessionRuntimeRunning: (sessionFile, running) =>
      set((state) => {
        const key = runtimeKey(sessionFile)
        if (!key) return state
        const next = withoutSessionRuntime(state.sessionRuntimeRunning, sessionFile)
        if (running) next[key] = true
        return { sessionRuntimeRunning: next }
      }),
    reconcileSessionRuntimeIdle: (sessionFile) =>
      set((state) => {
        const sessionRuntimeRunning = withoutSessionRuntime(
          state.sessionRuntimeRunning,
          sessionFile,
        )
        if (!sessionFilesEqual(state.historySessionFile, sessionFile)) {
          return { sessionRuntimeRunning }
        }
        return {
          sessionRuntimeRunning,
          streamingAssistantId: null,
          optimisticPendingUserText: null,
          agentTurnBootstrapping: false,
        }
      }),
  }
}
