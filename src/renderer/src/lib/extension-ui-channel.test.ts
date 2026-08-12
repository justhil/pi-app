import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissExtensionDialogState } from './extension-ui-channel'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({})) },
  onExtensionUIRequest: vi.fn(),
  onExtensionUIDismiss: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/lib/desktop-alerts', () => ({ signalDesktopAlert: vi.fn() }))
vi.mock('@renderer/lib/audio-trace', () => ({ traceAudioRenderer: vi.fn() }))
vi.mock('@renderer/lib/alert-trace', () => ({ alertTrace: vi.fn() }))
vi.mock('@renderer/lib/extension-ui-tool-sync', () => ({
  linkExtensionDialogToToolRow: vi.fn(),
  reconcileAllStaleInteractiveToolRows: vi.fn(),
  reconcileStaleInteractiveToolRows: vi.fn(),
}))

beforeEach(() => {
  useExtensionUIStore.setState({ activePending: null, suspended: null })
})

describe('dismissExtensionDialogState', () => {
  it('clears a suspended dialog when its source dismisses it', () => {
    useExtensionUIStore.setState({
      activePending: null,
      suspended: {
        requestId: 'dialog-1',
        pending: { id: 'dialog-1', method: 'confirm', title: 'Confirm', message: 'Continue?' },
        suspendedAt: 1,
      },
    })

    dismissExtensionDialogState('dialog-1')

    expect(useExtensionUIStore.getState().suspended).toBeNull()
  })

  it('keeps a different suspended dialog', () => {
    const suspended = {
      requestId: 'dialog-2',
      pending: { id: 'dialog-2', method: 'confirm' as const, title: 'Confirm', message: 'Continue?' },
      suspendedAt: 1,
    }
    useExtensionUIStore.setState({ activePending: null, suspended })

    dismissExtensionDialogState('dialog-1')

    expect(useExtensionUIStore.getState().suspended).toEqual(suspended)
  })
})
