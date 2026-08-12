import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppUpdateCheckResult } from '@shared/app-update'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettings } from './settings-general-appearance'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  translate: vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  ),
  showAppUpdateDialog: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/lib/app-update-notify', () => ({
  showAppUpdateDialog: mocks.showAppUpdateDialog,
}))

vi.mock('@renderer/features/settings/settings-draft-context', () => ({
  useSettingsDraft: () => ({
    draft: {
      autoOpenLastProject: false,
      autoCheckRegistryUpdates: true,
      alertSoundEnabled: false,
      alertNotificationEnabled: false,
      alertOnExtensionUi: false,
      alertOnRunIdle: false,
      alertOnBackgroundRunIdle: false,
      maxSessionWorkers: 2,
      sessionWorkerIdleTimeoutMinutes: 10,
      language: 'en',
    },
    setAutoOpenLastProject: vi.fn(),
    setAutoCheckRegistryUpdates: vi.fn(),
    setLanguage: vi.fn(),
    setAlertSoundEnabled: vi.fn(),
    setAlertNotificationEnabled: vi.fn(),
    setAlertOnExtensionUi: vi.fn(),
    setAlertOnRunIdle: vi.fn(),
    setAlertOnBackgroundRunIdle: vi.fn(),
    setMaxSessionWorkers: vi.fn(),
    setSessionWorkerIdleTimeoutMinutes: vi.fn(),
  }),
}))

vi.mock('@renderer/features/settings/pi-settings-panel', () => ({ PiSettingsPanel: () => null }))
vi.mock('@renderer/features/settings/appearance-theme-editor', () => ({ AppearanceThemeEditor: () => null }))
vi.mock('@renderer/features/settings/runtime-settings-panel', () => ({ RuntimeSettingsPanel: () => null }))

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function checkUpdateButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /settings:general\.(checkUpdate|checking)/,
  }) as HTMLButtonElement
}

function clickCheckUpdate(): void {
  fireEvent.click(checkUpdateButton())
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.translate.mockClear()
  mocks.showAppUpdateDialog.mockReset()
  mocks.invoke.mockImplementation((method: string) => {
    if (method === 'settings.get') return Promise.resolve({ settings: {} })
    return Promise.resolve({ status: 'error' })
  })
})

describe('GeneralSettings manual update feedback', () => {
  it('consumes a terminal result after the StrictMode effect remount', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    render(
      <StrictMode>
        <GeneralSettings />
      </StrictMode>,
    )

    clickCheckUpdate()

    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('consumes an immediate terminal result from the invoked check', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    render(<GeneralSettings />)

    clickCheckUpdate()

    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
    expect(mocks.showAppUpdateDialog).not.toHaveBeenCalled()
  })

  it('renders a failed terminal result without exposing network details', async () => {
    render(<GeneralSettings />)

    clickCheckUpdate()

    expect(await screen.findByText('settings:general.updateCheckFailed')).toBeInTheDocument()
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('opens the existing dialog for an available update', async () => {
    const update = {
      currentVersion: '0.5.6',
      latestVersion: '0.5.7',
      releaseUrl: 'https://example.test/releases/0.5.7',
      releaseNotes: 'Fixes',
      downloadUrl: 'https://example.test/setup.exe',
      downloadName: 'setup.exe',
      assets: [],
    }
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'available', update })
    })
    render(<GeneralSettings />)

    clickCheckUpdate()

    await waitFor(() => expect(mocks.showAppUpdateDialog).toHaveBeenCalledWith(update))
    expect(mocks.translate).toHaveBeenCalledWith('settings:general.updateHasNew', {
      version: '0.5.7',
      current: '0.5.6',
    })
  })

  it('ignores an older check that resolves after the current attempt', async () => {
    const first = deferred<AppUpdateCheckResult>()
    const second = deferred<AppUpdateCheckResult>()
    let checkCount = 0
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      checkCount += 1
      return checkCount === 1 ? first.promise : second.promise
    })
    render(<GeneralSettings />)

    const button = checkUpdateButton()
    fireEvent.click(button)
    expect(checkCount).toBe(1)
    fireEvent.click(button)
    expect(checkCount).toBe(2)
    await act(async () => {
      second.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    await act(async () => {
      first.resolve({ status: 'error' })
    })

    expect(screen.getByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(screen.queryByText('settings:general.updateCheckFailed')).not.toBeInTheDocument()
  })

  it('does not consume a pending result after unmount', async () => {
    const pending = deferred<AppUpdateCheckResult>()
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return pending.promise
    })
    const view = render(<GeneralSettings />)
    clickCheckUpdate()

    view.unmount()
    await act(async () => {
      pending.resolve({
        status: 'available',
        update: {
          currentVersion: '0.5.6',
          latestVersion: '0.5.7',
          releaseUrl: 'https://example.test/releases/0.5.7',
          releaseNotes: 'Fixes',
          downloadUrl: null,
          downloadName: null,
          assets: [],
        },
      })
    })

    expect(mocks.showAppUpdateDialog).not.toHaveBeenCalled()
  })
})
