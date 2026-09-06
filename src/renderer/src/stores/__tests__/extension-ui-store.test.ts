import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(() => Promise.resolve({ ok: true })) }))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      timelineItems: [],
      runState: { status: 'running' },
      historySessionFile: '/sessions/current.jsonl',
      setSessionWaitingUi: () => {},
    }),
  },
}))

import { useExtensionUIStore } from '../extension-ui-store'

const pending = { id: 'dialog-1', method: 'confirm' as const, title: 'Confirm', message: 'Continue?' }

describe('extension UI cancellation', () => {
  beforeEach(() => {
    invoke.mockClear()
    useExtensionUIStore.setState({ activePending: null, suspended: null })
  })

  it('should_cancel_suspended_dialog_when_session_context_resets', () => {
    const store = useExtensionUIStore.getState()
    store.setActivePending(pending)
    store.suspendActive({ toolCallId: 'tool-1' })

    useExtensionUIStore.getState().resetForSessionContext()

    expect(invoke).toHaveBeenCalledWith('extension.cancelUI', {
      id: 'dialog-1',
      reason: 'session-reset',
    })
    expect(useExtensionUIStore.getState().suspended).toBeNull()
  })

  it('should_not_cancel_after_a_response_has_already_been_sent', () => {
    useExtensionUIStore.getState().setActivePending(pending)

    useExtensionUIStore.getState().clearAfterRespond()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('should_keep_background_suspension_when_composer_prunes_stale_rows', () => {
    const background = {
      id: 'bg-1',
      method: 'confirm' as const,
      title: 'Confirm',
      message: 'Continue?',
      sessionFile: '/sessions/a.jsonl',
    }
    const store = useExtensionUIStore.getState()
    store.setActivePending(background)
    store.suspendActive({})

    store.pruneStaleSuspension()

    expect(useExtensionUIStore.getState().suspended?.requestId).toBe('bg-1')
  })

  it('should_keep_background_suspension_when_foreground_dialog_is_answered', () => {
    const background = {
      id: 'bg-1',
      method: 'confirm' as const,
      title: 'Confirm',
      message: 'Continue?',
      sessionFile: '/sessions/a.jsonl',
    }
    const foreground = {
      id: 'fg-1',
      method: 'confirm' as const,
      title: 'Confirm',
      message: 'Now?',
      sessionFile: '/sessions/b.jsonl',
    }
    const store = useExtensionUIStore.getState()
    store.setActivePending(background)
    store.suspendActive({})
    store.setActivePending(foreground)

    store.clearAfterRespond()

    const next = useExtensionUIStore.getState()
    expect(next.activePending).toBeNull()
    expect(next.suspended?.requestId).toBe('bg-1')
  })
})
