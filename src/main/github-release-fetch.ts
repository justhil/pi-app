import { errorMessage } from '@shared/error-message'

const API = 'https://api.github.com'
const RELEASE_ERROR = '无法读取 GitHub Releases'

export type GhAsset = {
  name?: string
  browser_download_url?: string
  size?: number
}

export type GhRelease = {
  tag_name?: string
  html_url?: string
  body?: string | null
  prerelease?: boolean
  draft?: boolean
  assets?: GhAsset[]
}

export type ReleaseFetch = (input: string, init?: RequestInit) => Promise<Response>

export type GitHubReleaseFetchResult =
  | { ok: true; release: GhRelease & { tag_name: string } }
  | { ok: false; error: string; detail: string }

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pi-desktop',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchLatestGitHubRelease(
  slug: string,
  fetch: ReleaseFetch,
  includePrerelease = false,
): Promise<GitHubReleaseFetchResult> {
  const headers = githubHeaders()
  const signal = AbortSignal.timeout(25_000)

  try {
    if (includePrerelease) {
      const list = await fetch(`${API}/repos/${slug}/releases?per_page=10`, { headers, signal })
      if (!list.ok) {
        return { ok: false, error: RELEASE_ERROR, detail: `list_http_${list.status}` }
      }
      const releases = (await list.json()) as GhRelease[]
      const release = releases.find((row) => row?.tag_name && !row.draft)
      if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
      return { ok: true, release: release as GhRelease & { tag_name: string } }
    }
    const response = await fetch(`${API}/repos/${slug}/releases/latest`, { headers, signal })
    if (response.status === 404) {
      const list = await fetch(`${API}/repos/${slug}/releases?per_page=5`, { headers, signal })
      if (!list.ok) {
        return { ok: false, error: RELEASE_ERROR, detail: `list_http_${list.status}` }
      }
      const releases = (await list.json()) as GhRelease[]
      const release = releases.find(
        (row) => row?.tag_name && !row.draft && !row.prerelease && !String(row.tag_name).includes('draft'),
      )
      if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
      return { ok: true, release: release as GhRelease & { tag_name: string } }
    }
    if (!response.ok) {
      return { ok: false, error: RELEASE_ERROR, detail: `latest_http_${response.status}` }
    }
    const release = (await response.json()) as GhRelease
    if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
    return { ok: true, release: release as GhRelease & { tag_name: string } }
  } catch (error: unknown) {
    const detail = errorMessage(error)
    return { ok: false, error: RELEASE_ERROR, detail }
  }
}
