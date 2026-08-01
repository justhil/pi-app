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

import { checkGitHubReleaseUpdate } from './github-release-check'

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
