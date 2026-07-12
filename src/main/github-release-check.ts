import { app } from 'electron'
import log from 'electron-log'
import { errorMessage } from '@shared/error-message'
import type { AppUpdateAsset, AppUpdateAssetKind } from '@shared/app-update'
import { emitOperationEvent } from './operation-events'

const DEFAULT_REPO = 'justhil/pi-app'
const API = 'https://api.github.com'

export type GitHubReleaseCheckResult = {
  ok: boolean
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string
  releaseNotes: string
  downloadUrl: string | null
  downloadName: string | null
  assets: AppUpdateAsset[]
  error?: string
}

type GhAsset = {
  name?: string
  browser_download_url?: string
  size?: number
}

type GhRelease = {
  tag_name?: string
  html_url?: string
  body?: string | null
  assets?: GhAsset[]
}

function repoSlug(): string {
  return (process.env.PI_DESKTOP_GITHUB_REPO || DEFAULT_REPO).trim()
}

export function parseSemver(tag: string): number[] {
  const match = String(tag).trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return [0]
  return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0]
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const candidateParts = parseSemver(candidate)
  const currentParts = parseSemver(current)
  const length = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < length; index++) {
    const left = candidateParts[index] ?? 0
    const right = currentParts[index] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}

export function classifyAssetName(name: string): AppUpdateAssetKind {
  const lower = name.toLowerCase()
  if (lower.includes('setup') && lower.endsWith('.exe')) return 'setup'
  if (lower.includes('portable') && lower.endsWith('.exe')) return 'portable'
  if (lower.endsWith('.exe')) return 'setup'
  if (lower.endsWith('.dmg')) return 'dmg'
  if (lower.endsWith('.zip') && (lower.includes('mac') || lower.includes('darwin'))) return 'zip'
  if (lower.endsWith('.appimage')) return 'appimage'
  if (lower.endsWith('.deb')) return 'deb'
  return 'other'
}

/**
 * GitHub Release body used as in-app announcement.
 * Treats legacy link-only placeholders as empty so the UI can show a neutral fallback.
 */
export function sanitizeReleaseNotes(body: string | null | undefined): string {
  const raw = String(body || '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!raw) return ''

  // Old CI template: only CHANGELOG / RELEASE.md links, no real notes
  const stripped = raw
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>|~\-]+/g, ' ')
    .replace(/[：:：，,。.！!？?（）()【】\[\]「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!stripped) return ''

  const placeholderPhrases = [
    '完整更新日志',
    'release 说明',
    'release说明',
    'see changelog',
    'see the changelog',
    'changelog.md',
    'doc/release.md',
    'release.md',
    '更新日志',
    'changelog',
  ]
  const onlyPlaceholders = stripped
    .split(' ')
    .filter(Boolean)
    .every((token) => placeholderPhrases.some((phrase) => token.includes(phrase) || phrase.includes(token)))

  // Short bodies that only mention changelog/release docs
  const shortDocPointer =
    stripped.length < 100 &&
    (stripped.includes('changelog') ||
      stripped.includes('release.md') ||
      stripped.includes('完整更新日志') ||
      stripped.includes('更新日志'))

  if (onlyPlaceholders || shortDocPointer) return ''
  return raw
}

/** Pick best installer for process.platform from release assets. */
export function pickDownloadAsset(
  assets: AppUpdateAsset[],
  platform: NodeJS.Platform = process.platform,
): AppUpdateAsset | null {
  if (assets.length === 0) return null
  const preference: AppUpdateAssetKind[] =
    platform === 'win32'
      ? ['setup', 'portable']
      : platform === 'darwin'
        ? ['dmg', 'zip']
        : ['appimage', 'deb']

  for (const kind of preference) {
    const match = assets.find((asset) => asset.kind === kind)
    if (match) return match
  }
  // Fallback: any non-other asset for this OS by extension
  if (platform === 'win32') {
    return assets.find((asset) => asset.name.toLowerCase().endsWith('.exe')) || null
  }
  if (platform === 'darwin') {
    return (
      assets.find((asset) => asset.name.toLowerCase().endsWith('.dmg')) ||
      assets.find((asset) => asset.name.toLowerCase().endsWith('.zip')) ||
      null
    )
  }
  return (
    assets.find((asset) => asset.name.toLowerCase().endsWith('.appimage')) ||
    assets.find((asset) => asset.name.toLowerCase().endsWith('.deb')) ||
    null
  )
}

function mapAssets(raw: GhAsset[] | undefined): AppUpdateAsset[] {
  if (!Array.isArray(raw)) return []
  const out: AppUpdateAsset[] = []
  for (const item of raw) {
    const name = String(item.name || '').trim()
    const url = String(item.browser_download_url || '').trim()
    if (!name || !url) continue
    out.push({
      name,
      url,
      size: typeof item.size === 'number' ? item.size : 0,
      kind: classifyAssetName(name),
    })
  }
  return out
}

async function githubHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pi-desktop',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchLatestRelease(slug: string): Promise<GhRelease | null> {
  const headers = await githubHeaders()
  const signal = AbortSignal.timeout(25_000)
  const response = await fetch(`${API}/repos/${slug}/releases/latest`, { headers, signal })
  if (response.status === 404) {
    const list = await fetch(`${API}/repos/${slug}/releases?per_page=5`, { headers, signal })
    if (!list.ok) return null
    const arr = (await list.json()) as GhRelease[]
    const first = arr?.find((row) => row?.tag_name && !String(row.tag_name).includes('draft'))
    return first || null
  }
  if (!response.ok) return null
  return (await response.json()) as GhRelease
}

export async function checkGitHubReleaseUpdate(): Promise<GitHubReleaseCheckResult> {
  const slug = repoSlug()
  const currentVersion = app.getVersion()
  const fallbackUrl = `https://github.com/${slug}/releases`
  const started = Date.now()
  emitOperationEvent({ operation: 'release.checkGitHub', status: 'start' })
  try {
    const latest = await fetchLatestRelease(slug)
    if (!latest?.tag_name) {
      emitOperationEvent({
        operation: 'release.checkGitHub',
        status: 'error',
        durationMs: Date.now() - started,
        detail: 'no_release',
      })
      return {
        ok: false,
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: fallbackUrl,
        releaseNotes: '',
        downloadUrl: null,
        downloadName: null,
        assets: [],
        error: '无法读取 GitHub Releases',
      }
    }
    const assets = mapAssets(latest.assets)
    const preferred = pickDownloadAsset(assets)
    const hasUpdate = isVersionNewer(latest.tag_name, currentVersion)
    const releaseUrl =
      latest.html_url || `https://github.com/${slug}/releases/tag/${latest.tag_name}`
    emitOperationEvent({
      operation: 'release.checkGitHub',
      status: 'ok',
      durationMs: Date.now() - started,
    })
    return {
      ok: true,
      currentVersion,
      latestVersion: latest.tag_name.replace(/^v/i, ''),
      hasUpdate,
      releaseUrl,
      releaseNotes: sanitizeReleaseNotes(latest.body),
      downloadUrl: preferred?.url ?? null,
      downloadName: preferred?.name ?? null,
      assets,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? errorMessage(error) : errorMessage(error)
    emitOperationEvent({
      operation: 'release.checkGitHub',
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'error',
      durationMs: Date.now() - started,
      detail: message,
    })
    log.warn('[GitHubRelease] check failed:', message)
    return {
      ok: false,
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: fallbackUrl,
      releaseNotes: '',
      downloadUrl: null,
      downloadName: null,
      assets: [],
      error: message,
    }
  }
}
