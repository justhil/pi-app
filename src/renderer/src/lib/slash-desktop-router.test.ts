import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), requestExtensionConfig: vi.fn(), setActivePanel: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      currentWorkspace: '/repo',
      requestExtensionConfig: mocks.requestExtensionConfig,
      setActivePanel: mocks.setActivePanel,
    }),
  },
}))

import { routeDesktopSlashBeforeSend } from './slash-desktop-router'

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.requestExtensionConfig.mockReset()
  mocks.setActivePanel.mockReset()
})

describe('routeDesktopSlashBeforeSend', () => {
  it('opens the config page for a bare config-page command', async () => {
    mocks.invoke.mockResolvedValue({ behavior: 'config-page', meta: { adapterId: 'pi-image-gen' } })
    expect(await routeDesktopSlashBeforeSend('/image-gen')).toEqual({ handled: true })
    expect(mocks.requestExtensionConfig).toHaveBeenCalledWith('pi-image-gen')
  })

  it('lets a config-page command with arguments run in the extension', async () => {
    mocks.invoke.mockResolvedValue({ behavior: 'config-page', meta: { adapterId: 'pi-image-gen' } })
    expect(await routeDesktopSlashBeforeSend('/image-gen generate a red bike')).toEqual({ handled: false })
    expect(mocks.requestExtensionConfig).not.toHaveBeenCalled()
  })

  it('opens the panel an open-panel command names', async () => {
    mocks.invoke.mockResolvedValue({ behavior: 'open-panel', meta: { adapterId: '@agnishc/edb-context-viewer', panelId: 'context' } })
    expect(await routeDesktopSlashBeforeSend('/context')).toEqual({ handled: true })
    expect(mocks.setActivePanel).toHaveBeenCalledWith('context')
  })
})
