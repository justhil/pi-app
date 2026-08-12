import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../ui-store'

describe('UI runtime state isolation', () => {
  beforeEach(() => {
    useUIStore.setState({
      historySessionFile: '/sessions/current.jsonl',
      sessionRuntimeRunning: {
        '/sessions/current.jsonl': true,
        '/sessions/background.jsonl': true,
      },
      streamingAssistantId: 'stale-assistant',
      optimisticPendingUserText: 'stale prompt',
      agentTurnBootstrapping: false,
    })
  })

  it('clears terminal runtime UI only for the focused session', () => {
    useUIStore.getState().reconcileSessionRuntimeIdle('/sessions/current.jsonl')

    const state = useUIStore.getState()
    expect(state.sessionRuntimeRunning).toEqual({ '/sessions/background.jsonl': true })
    expect(state.streamingAssistantId).toBeNull()
    expect(state.optimisticPendingUserText).toBeNull()
    expect(state.agentTurnBootstrapping).toBe(false)
  })

  it('does not clear focused UI when a background session becomes idle', () => {
    useUIStore.getState().reconcileSessionRuntimeIdle('/sessions/background.jsonl')

    const state = useUIStore.getState()
    expect(state.sessionRuntimeRunning).toEqual({ '/sessions/current.jsonl': true })
    expect(state.streamingAssistantId).toBe('stale-assistant')
    expect(state.optimisticPendingUserText).toBe('stale prompt')
  })

})
