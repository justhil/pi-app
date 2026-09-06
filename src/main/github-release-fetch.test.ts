import { describe, expect, it, vi } from 'vitest'
import { fetchLatestGitHubRelease } from './github-release-fetch'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchLatestGitHubRelease', () => {
  it('should_forward_github_token_to_latest_and_fallback_requests', async () => {
    const previousToken = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'test-token'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([{ tag_name: 'v0.4.20' }]))

    try {
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)

      expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer test-token',
      })
      expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer test-token',
      })
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousToken
    }
  })

  it('should_fall_back_to_gh_token_and_prefer_github_token', async () => {
    const previousGitHubToken = process.env.GITHUB_TOKEN
    const previousGhToken = process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    process.env.GH_TOKEN = 'gh-token'
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.4.20' }))

    try {
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)
      expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer gh-token',
      })

      process.env.GITHUB_TOKEN = 'github-token'
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)
      expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer github-token',
      })
    } finally {
      if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousGitHubToken
      if (previousGhToken === undefined) delete process.env.GH_TOKEN
      else process.env.GH_TOKEN = previousGhToken
    }
  })

  it('should_parse_latest_release_when_latest_returns_200', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
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
    )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: true,
      release: {
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
      },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\/latest$/)
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pi-desktop',
    })
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('should_fall_back_to_release_list_when_latest_returns_404', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse([
          {},
          { tag_name: 'v0.4.20', html_url: 'https://example.test/release', assets: [] },
        ]),
      )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: true,
      release: {
        tag_name: 'v0.4.20',
        html_url: 'https://example.test/release',
        assets: [],
      },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toMatch(/\/releases\?per_page=5$/)
    expect(fetch.mock.calls[1][1]?.signal).toBe(fetch.mock.calls[0][1]?.signal)
  })

  it('should_return_http_detail_when_github_returns_non_success', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'latest_http_503',
    })
  })

  it('should_return_list_http_detail_when_release_list_returns_non_success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'list_http_502',
    })
  })

  it('should_return_no_release_detail_when_release_list_is_empty', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([]))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'no_release',
    })
  })

  it('should_use_release_list_when_prerelease_is_requested', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { tag_name: 'v0.5.0-beta.1', prerelease: true, draft: false },
        { tag_name: 'v0.4.21', prerelease: false, draft: false },
      ]),
    )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch, true)

    expect(result).toEqual({
      ok: true,
      release: { tag_name: 'v0.5.0-beta.1', prerelease: true, draft: false },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\?per_page=10$/)
  })

  it.each([
    ['network', new TypeError('fetch failed'), 'fetch failed'],
    ['abort', new DOMException('The operation was aborted', 'AbortError'), 'The operation was aborted'],
  ])('should_return_stable_failure_when_%s_error_is_thrown', async (_kind, error, message) => {
    const fetch = vi.fn().mockRejectedValue(error)

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: message,
    })
  })
})
