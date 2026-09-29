import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.4.20'),
  fetch: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getVersion: electron.getVersion },
  net: { fetch: electron.fetch },
}))

vi.mock('electron-log', () => ({
  default: { warn: vi.fn() },
}))

vi.mock('./operation-events', () => ({
  emitOperationEvent: vi.fn(),
}))

vi.mock('./config-store', () => ({
  configStore: { get: vi.fn(() => undefined) },
}))

import {
  checkGitHubReleaseUpdate,
  classifyAssetName,
  pickDownloadAsset,
} from './github-release-check'

describe('pickDownloadAsset architecture (#97)', () => {
  const asset = (name: string) => ({
    name,
    url: `https://example.test/${name}`,
    size: 1,
    kind: classifyAssetName(name),
  })
  // v0.5.8 release assets in GitHub's alphabetical order: arm64 dmg sorts before x64.
  const release = [
    'pi.Desktop-0.5.8-amd64.deb',
    'pi.Desktop-0.5.8-arm64.dmg',
    'pi.Desktop-0.5.8-arm64.dmg.blockmap',
    'pi.Desktop-0.5.8-arm64.zip',
    'pi.Desktop-0.5.8-x64.dmg',
    'pi.Desktop-0.5.8-x64.zip',
    'pi.Desktop-0.5.8-x86_64.AppImage',
    'pi.Desktop-Portable-0.5.8-x64.exe',
    'pi.Desktop-Setup-0.5.8-x64.exe',
  ].map(asset)

  it('should_pick_x64_dmg_on_intel_mac', () => {
    expect(pickDownloadAsset(release, 'darwin', 'x64')?.name).toBe('pi.Desktop-0.5.8-x64.dmg')
  })

  it('should_pick_arm64_dmg_on_apple_silicon', () => {
    expect(pickDownloadAsset(release, 'darwin', 'arm64')?.name).toBe('pi.Desktop-0.5.8-arm64.dmg')
  })

  it('should_keep_windows_and_linux_x64_choices', () => {
    expect(pickDownloadAsset(release, 'win32', 'x64')?.name).toBe('pi.Desktop-Setup-0.5.8-x64.exe')
    expect(pickDownloadAsset(release, 'linux', 'x64')?.name).toBe('pi.Desktop-0.5.8-x86_64.AppImage')
  })

  it('should_accept_assets_without_architecture_label', () => {
    expect(pickDownloadAsset([asset('pi.Desktop-0.5.8.dmg')], 'darwin', 'x64')?.name).toBe(
      'pi.Desktop-0.5.8.dmg',
    )
  })

  it('should_not_offer_an_installer_for_another_architecture', () => {
    expect(pickDownloadAsset([asset('pi.Desktop-0.5.8-arm64.dmg')], 'darwin', 'x64')).toBeNull()
  })
})

describe('checkGitHubReleaseUpdate network wiring', () => {
  beforeEach(() => {
    electron.fetch.mockReset()
    electron.getVersion.mockReturnValue('0.4.20')
  })

  it('should_use_electron_net_fetch_for_release_requests', async () => {
    electron.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: 'v0.4.21',
          html_url: 'https://github.com/justhil/pi-app/releases/tag/v0.4.21',
          body: '## Fixes',
          assets: [
            {
              name: 'pi Desktop-Setup-0.4.21-x64.exe',
              browser_download_url: 'https://example.test/setup.exe',
              size: 42,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    let result: Awaited<ReturnType<typeof checkGitHubReleaseUpdate>>
    try {
      result = await checkGitHubReleaseUpdate()
    } finally {
      Object.defineProperty(process, 'platform', { value: platform })
    }

    expect(electron.fetch).toHaveBeenCalledTimes(1)
    expect(electron.fetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/justhil/pi-app/releases/latest',
    )
    expect(electron.fetch.mock.calls[0][1]).toMatchObject({
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pi-desktop',
      },
    })
    expect(electron.fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(result).toMatchObject({
      ok: true,
      currentVersion: '0.4.20',
      latestVersion: '0.4.21',
      hasUpdate: true,
      releaseNotes: '## Fixes',
      downloadUrl: 'https://example.test/setup.exe',
      downloadName: 'pi Desktop-Setup-0.4.21-x64.exe',
      assets: [
        {
          name: 'pi Desktop-Setup-0.4.21-x64.exe',
          url: 'https://example.test/setup.exe',
          size: 42,
          kind: 'setup',
        },
      ],
    })
  })
})
