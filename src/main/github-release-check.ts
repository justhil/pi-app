import { app } from 'electron'
import log from 'electron-log'
import { errorMessage } from '@shared/error-message'
import { emitOperationEvent } from './operation-events'

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

  const signal = AbortSignal.timeout(25_000)
  const res = await fetch(`${API}/repos/${slug}/releases/latest`, { headers, signal })
  if (res.status === 404) {
    const list = await fetch(`${API}/repos/${slug}/releases?per_page=1`, { headers, signal })
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
  const started = Date.now()
  emitOperationEvent({ operation: 'release.checkGitHub', status: 'start' })
  try {
    const latest = await fetchLatestReleaseTag(slug)
    if (!latest) {
      emitOperationEvent({ operation: 'release.checkGitHub', status: 'error', durationMs: Date.now() - started, detail: 'no_release' })
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
    emitOperationEvent({ operation: 'release.checkGitHub', status: 'ok', durationMs: Date.now() - started })
    return {
      ok: true,
      currentVersion,
      latestVersion: latest.tag.replace(/^v/i, ''),
      hasUpdate,
      releaseUrl: latest.htmlUrl,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? errorMessage(e) : errorMessage(e)
    emitOperationEvent({
      operation: 'release.checkGitHub',
      status: msg.toLowerCase().includes('timeout') ? 'timeout' : 'error',
      durationMs: Date.now() - started,
      detail: msg,
    })
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