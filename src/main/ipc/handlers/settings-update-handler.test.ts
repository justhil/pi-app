import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  checkGitHubReleaseUpdate: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
  registerHandlerWithSchema: (
    channel: string,
    _schema: unknown,
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../../github-release-check', () => ({
  checkGitHubReleaseUpdate: mocks.checkGitHubReleaseUpdate,
}))

vi.mock('../../config-store', () => ({
  configStore: { get: vi.fn(), getAll: vi.fn(() => ({})), set: vi.fn() },
}))
vi.mock('../../asr-config-store', () => ({
  asrConfigForSettingsResponse: vi.fn((value) => value),
  loadAsrConfig: vi.fn(() => ({})),
  saveAsrConfig: vi.fn(),
}))
vi.mock('../../../extension-compat/adapter-loader', () => ({ invalidateAdapterCatalog: vi.fn() }))
vi.mock('../../worker-manager', () => ({ workerManager: { hasActiveTurns: false, stop: vi.fn() } }))
vi.mock('../../sdk-manager', () => ({ invalidateSdkManagerCaches: vi.fn() }))
vi.mock('../sdk-session', () => ({ invalidateListSessionsCache: vi.fn() }))
vi.mock('../../window', () => ({ getMainWindow: vi.fn() }))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

import { registerSettingsHandlers } from './settings'

const availableResult = {
  ok: true,
  currentVersion: '0.5.6',
  latestVersion: '0.5.7',
  hasUpdate: true,
  releaseUrl: 'https://example.test/releases/0.5.7',
  releaseNotes: 'Fixes',
  downloadUrl: 'https://example.test/setup.exe',
  downloadName: 'setup.exe',
  assets: [
    {
      name: 'setup.exe',
      url: 'https://example.test/setup.exe',
      size: 42,
      kind: 'setup' as const,
    },
  ],
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.checkGitHubReleaseUpdate.mockReset()
  registerSettingsHandlers()
})

describe('manual update check terminal result', () => {
  it('returns an available result directly without emitting the automatic prompt event', async () => {
    mocks.checkGitHubReleaseUpdate.mockResolvedValue(availableResult)

    const result = await mocks.handlers.get('ipc:app.checkUpdate')!({})

    expect(result).toEqual({
      status: 'available',
      update: {
        currentVersion: '0.5.6',
        latestVersion: '0.5.7',
        releaseUrl: 'https://example.test/releases/0.5.7',
        releaseNotes: 'Fixes',
        downloadUrl: 'https://example.test/setup.exe',
        downloadName: 'setup.exe',
        assets: availableResult.assets,
      },
    })
  })

  it('returns up-to-date instead of leaving the renderer waiting', async () => {
    mocks.checkGitHubReleaseUpdate.mockResolvedValue({
      ...availableResult,
      latestVersion: '0.5.6',
      hasUpdate: false,
      downloadUrl: null,
      downloadName: null,
      assets: [],
    })

    await expect(mocks.handlers.get('ipc:app.checkUpdate')!({})).resolves.toEqual({
      status: 'up-to-date',
      currentVersion: '0.5.6',
      latestVersion: '0.5.6',
    })
  })

  it('returns a stable error without exposing the raw network detail', async () => {
    mocks.checkGitHubReleaseUpdate.mockResolvedValue({
      ...availableResult,
      ok: false,
      latestVersion: null,
      hasUpdate: false,
      error: 'Unable to read GitHub Releases: proxy http://user:secret@example.test',
    })

    await expect(mocks.handlers.get('ipc:app.checkUpdate')!({})).resolves.toEqual({ status: 'error' })
  })

  it('returns error when the release check rejects', async () => {
    mocks.checkGitHubReleaseUpdate.mockRejectedValue(new Error('network failure'))

    await expect(mocks.handlers.get('ipc:app.checkUpdate')!({})).resolves.toEqual({ status: 'error' })
  })
})
