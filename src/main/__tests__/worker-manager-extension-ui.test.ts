import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import type { WorkerTransport } from '../worker-transport'

vi.mock('../config-store', () => ({
  configStore: { get: vi.fn(() => undefined) },
}))

import {
  attachWorkerHandlers,
  dismissExtensionUiRequestsForSlot,
  extensionUiDialogSource,
} from '../worker-manager-pool'
import { WorkerManager } from '../worker-manager'

function makeTransport(): WorkerTransport & { emitMessage: (message: Record<string, unknown>) => void } {
  const listeners: Array<(message: Record<string, unknown>) => void> = []
  return {
    kind: 'utilityProcess',
    postMessage: vi.fn(),
    onMessage: (listener) => listeners.push(listener as (message: Record<string, unknown>) => void),
    onExit: () => {},
    onStdout: () => {},
    onStderr: () => {},
    kill: () => {},
    emitMessage: (message) => listeners.forEach((listener) => listener(message)),
  }
}

function slot(poolKey: string, worker: WorkerTransport = makeTransport()): WorkerSlot {
  return {
    poolKey,
    cwd: '/w',
    runtime: { mode: 'host', distro: null },
    sessionFile: poolKey,
    worker,
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: true,
    lastIdleAt: Date.now(),
    lastForegroundAt: Date.now(),
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

function managerWithSlots(foreground: WorkerSlot, ...rest: WorkerSlot[]): WorkerManager {
  const manager = new WorkerManager()
  const internals = manager as unknown as { pool: Map<string, WorkerSlot>; foregroundPoolKey: string | null }
  internals.pool.set(foreground.poolKey, foreground)
  for (const row of rest) internals.pool.set(row.poolKey, row)
  internals.foregroundPoolKey = foreground.poolKey
  return manager
}

describe('extension UI source routing', () => {
  beforeEach(() => extensionUiDialogSource.clear())

  it('should_route_responses_to_the_dialog_origin', () => {
    const foreground = slot('/s/foreground')
    const background = slot('/s/background')
    extensionUiDialogSource.set('dialog-b', background)

    managerWithSlots(foreground, background).respondExtensionUI({ id: 'dialog-b', confirmed: true })

    expect(background.worker.postMessage).toHaveBeenCalledWith({
      type: 'extension-ui-response',
      response: { id: 'dialog-b', confirmed: true },
    })
    expect(foreground.worker.postMessage).not.toHaveBeenCalled()
  })

  it('should_drop_stale_sources_instead_of_falling_back_to_foreground', () => {
    const foreground = slot('/s/foreground')
    extensionUiDialogSource.set('stale-dialog', slot('/s/missing'))

    managerWithSlots(foreground).respondExtensionUI({ id: 'stale-dialog', confirmed: true })

    expect(foreground.worker.postMessage).not.toHaveBeenCalled()
  })

  it('should_cancel_the_dialog_origin', () => {
    const foreground = slot('/s/foreground')
    const background = slot('/s/background')
    extensionUiDialogSource.set('dialog-b', background)

    managerWithSlots(foreground, background).cancelExtensionUI('dialog-b', 'session-reset')

    expect(background.worker.postMessage).toHaveBeenCalledWith({
      type: 'extension-ui-cancel',
      cancel: { id: 'dialog-b', reason: 'session-reset' },
    })
    expect(foreground.worker.postMessage).not.toHaveBeenCalled()
  })

  it('should_dismiss_only_dialogs_owned_by_the_emitting_slot', () => {
    const background = slot('/s/background')
    const send = vi.fn()
    extensionUiDialogSource.set('dialog-a', slot('/s/foreground'))
    extensionUiDialogSource.set('dialog-b', background)

    dismissExtensionUiRequestsForSlot(background, send, 'compaction')

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'extension-ui-dismiss',
      id: 'dialog-b',
      reason: 'compaction',
    })
    expect(extensionUiDialogSource.has('dialog-a')).toBe(true)
    expect(extensionUiDialogSource.has('dialog-b')).toBe(false)
  })

  it('should_dismiss_dialogs_when_the_source_worker_exits', () => {
    const transport = makeTransport()
    const exitListeners: Array<(code: number) => void> = []
    transport.onExit = (listener) => exitListeners.push(listener)
    const source = slot('/s/source', transport)
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    attachWorkerHandlers(source, transport, {
      mainWindow: mainWindow as never,
      getForegroundPoolKey: () => source.poolKey,
      onAppEvent: vi.fn(),
      onSlotExit: vi.fn(),
    })
    extensionUiDialogSource.set('dialog-source', source)

    exitListeners.forEach((listener) => listener(1))

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('ipc:extension-ui-dismiss', {
      type: 'extension-ui-dismiss',
      id: 'dialog-source',
      reason: 'worker-stopped',
    })
    expect(extensionUiDialogSource.has('dialog-source')).toBe(false)
  })

  it('should_register_foreground_dialog_origin_without_forwarding_background_dialogs', () => {
    const foregroundTransport = makeTransport()
    const foreground = slot('/s/foreground', foregroundTransport)
    const backgroundTransport = makeTransport()
    const background = slot('/s/background', backgroundTransport)
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const options = {
      mainWindow: mainWindow as never,
      getForegroundPoolKey: () => foreground.poolKey,
      onAppEvent: vi.fn(),
      onSlotExit: vi.fn(),
    }
    attachWorkerHandlers(foreground, foregroundTransport, options)
    attachWorkerHandlers(background, backgroundTransport, options)

    backgroundTransport.emitMessage({
      type: 'extension-ui-request',
      request: { id: 'dialog-b', method: 'confirm', title: 'Confirm', message: 'Continue?' },
    })
    foregroundTransport.emitMessage({
      type: 'extension-ui-request',
      request: { id: 'dialog-a', method: 'confirm', title: 'Confirm', message: 'Continue?' },
    })

    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1)
    expect(extensionUiDialogSource.get('dialog-a')).toBe(foreground)
    expect(extensionUiDialogSource.has('dialog-b')).toBe(false)
  })
})
