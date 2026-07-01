import { app } from 'electron'
import log from 'electron-log'

const DEFAULT_REPO = 'justhil/pi-app'
const API = 'https://api.github.com'

export type GitHubReleaseCheckResult = {
  ok: boolean
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string
  error?: string
}

function repoSlug(): string {
  return (process.env.PI_DESKTOP_GITHUB_REPO || DEFAULT_REPO).trim()
}

export function parseSemver(tag: string): number[] {
  const m = String(tag).trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return [0]
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0]
}

export function isVersionNewer(a: string, b: string): boolean {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function fetchLatestReleaseTag(slug: string): Promise<{ tag: string; htmlUrl: string } | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pi-desktop',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API}/repos/${slug}/releases/latest`, { headers })
  if (res.status === 404) {
    const list = await fetch(`${API}/repos/${slug}/releases?per_page=1`, { headers })
    if (!list.ok) return null
    const arr = (await list.json()) as { tag_name?: string; html_url?: string }[]
    const first = arr?.[0]
    if (!first?.tag_name) return null
    return { tag: first.tag_name, htmlUrl: first.html_url || `https://github.com/${slug}/releases` }
  }
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name?: string; html_url?: string }
  if (!data?.tag_name) return null
  return {
    tag: data.tag_name,
    htmlUrl: data.html_url || `https://github.com/${slug}/releases/tag/${data.tag_name}`,
  }
}

export async function checkGitHubReleaseUpdate(): Promise<GitHubReleaseCheckResult> {
  const slug = repoSlug()
  const currentVersion = app.getVersion()
  const fallbackUrl = `https://github.com/${slug}/releases`
  try {
    const latest = await fetchLatestReleaseTag(slug)
    if (!latest) {
      return {
        ok: false,
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: fallbackUrl,
        error: '无法读取 GitHub Releases',
      }
    }
    const hasUpdate = isVersionNewer(latest.tag, currentVersion)
    return {
      ok: true,
      currentVersion,
      latestVersion: latest.tag.replace(/^v/i, ''),
      hasUpdate,
      releaseUrl: latest.htmlUrl,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn('[GitHubRelease] check failed:', msg)
    return {
      ok: false,
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: fallbackUrl,
      error: msg,
    }
  }
}