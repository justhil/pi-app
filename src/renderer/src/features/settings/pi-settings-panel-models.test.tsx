import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PiSettingsPanel } from './pi-settings-panel'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  clearAvailableModelsCacheForTests,
  invalidateAvailableModels,
  peekAvailableModels,
  refreshAvailableModels,
} from '@renderer/lib/available-models-cache'

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: (selector: (state: { currentWorkspace: string | null }) => unknown) => selector({ currentWorkspace: null }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: vi.fn(() => () => {}),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('./pi-settings-sdk-section', () => ({ PiSettingsSdkSection: () => null }))
vi.mock('./pi-settings-env-auth-rows', () => ({ PiSettingsEnvAuthRows: () => null }))
vi.mock('./settings-shell', () => ({ SettingsPageHeader: () => null }))
vi.mock('./settings-page-shared', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>{label}{children}</label>
  ),
  Toggle: () => null,
}))
vi.mock('@renderer/features/settings/use-settings-dirty-slice', () => ({ useSettingsDirtySlice: vi.fn() }))
vi.mock('@renderer/features/settings/settings-dirty-registry', () => ({ notifySettingsDirtyChanged: vi.fn() }))
vi.mock('@renderer/features/settings/settings-draft-context', () => ({ useSettingsDraft: () => ({ draft: null }) }))
vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn() }))

const invoke = vi.mocked(ipcClient.invoke)

beforeEach(() => {
  invoke.mockReset()
  clearAvailableModelsCacheForTests()
  invoke.mockImplementation((method) => {
    if (method === 'pi.getInfo') return Promise.resolve({})
    if (method === 'pi.settings.get') {
      return Promise.resolve({ settings: { defaultProvider: 'legacy', defaultModel: 'saved' } })
    }
    if (method === 'model.list') {
      return Promise.resolve({
        models: [
          { provider: 'user-relay', id: 'custom', name: 'Custom', available: true },
          { provider: 'anthropic', id: 'logged-in', name: 'Logged in', available: true },
        ],
      })
    }
    if (method === 'sdk.status') return Promise.resolve({ active: { kind: 'builtin' } })
    if (method === 'sdk.listAvailable') return Promise.resolve({ versions: [], latest: null })
    if (method === 'settings.get') return Promise.resolve({ settings: {} })
    if (method === 'adapters.json.catalog') return Promise.resolve({ adapters: [] })
    return Promise.resolve({})
  })
})

describe('PiSettingsPanel default model visibility', () => {
  it('refreshes an invalidated cache before resolving the default model list', async () => {
    invoke.mockResolvedValueOnce({ models: [{ provider: 'old', id: 'stale', available: true }] })
    await refreshAvailableModels()
    invalidateAvailableModels()
    invoke.mockImplementation((method) => {
      if (method === 'pi.getInfo') return Promise.resolve({})
      if (method === 'pi.settings.get') return Promise.resolve({ settings: {} })
      if (method === 'model.list') {
        return Promise.resolve({ models: [{ provider: 'new', id: 'fresh', available: true }] })
      }
      if (method === 'sdk.status') return Promise.resolve({ active: { kind: 'builtin' } })
      if (method === 'sdk.listAvailable') return Promise.resolve({ versions: [], latest: null })
      return Promise.resolve({})
    })

    render(<PiSettingsPanel />)

    const select = await screen.findByRole('combobox', { name: /settings:pi\.defaultModel/i })
    await waitFor(() => expect(select).toHaveTextContent('new/fresh'))
    expect(select).not.toHaveTextContent('old/stale')
    expect(peekAvailableModels()).toMatchObject([{ provider: 'new', id: 'fresh' }])
  })

  it('uses only the available-model contract', async () => {
    render(<PiSettingsPanel />)

    const select = await screen.findByRole('combobox', { name: /settings:pi\.defaultModel/i })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('model.list', { scope: 'available' }))
    expect(invoke).not.toHaveBeenCalledWith('model.list', { scope: 'catalog' })
    expect(select).toHaveTextContent('user-relay/custom')
    expect(select).toHaveTextContent('anthropic/logged-in')
    expect(select).not.toHaveTextContent('legacy/saved')
  })
})
