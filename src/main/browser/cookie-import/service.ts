// Import sign-ins from a local browser into a built-in browser profile. The renderer only ever
// sees sources, per-site counts and a summary; cookie values stay inside this module.

import { session } from 'electron'
import { partitionForProfile } from '../electron-session'
import { CHROMIUM_BROWSERS, detectBrowserSources, type BrowserSource } from './browsers'
import { encryptionKeyFor } from './keys'
import { excludedReason, siteOf } from './policy'
import { readChromiumCookies, readFirefoxCookies, type ImportCookie, type ReadResult, type ReadStats } from './read'
import { clearSites, writeCookies } from './write'

export interface ImportSourceInfo {
  id: string
  label: string
  profiles: { directory: string; name: string }[]
}

export interface SiteGroup {
  site: string
  count: number
  excluded?: 'device-bound'
}

export interface ImportPreview {
  sites: SiteGroup[]
  stats: ReadStats
}

export interface ImportSummary {
  imported: number
  failed: number
  removed: number
  skipped: { excluded: number; expired: number; partitioned: number; appBound: number; undecryptable: number }
  keyringUnavailable: boolean
}

export function listImportSources(): ImportSourceInfo[] {
  return detectBrowserSources().map((s) => ({ id: s.id, label: s.label, profiles: s.profiles.map(({ directory, name }) => ({ directory, name })) }))
}

function readSource(sourceId: string, profileDir: string): ReadResult {
  const source: BrowserSource | undefined = detectBrowserSources().find((s) => s.id === sourceId)
  const profile = source?.profiles.find((p) => p.directory === profileDir)
  if (!source || !profile) throw new Error('import_source_missing')
  if (source.family === 'firefox') return readFirefoxCookies(profile.cookiesPath)
  const def = CHROMIUM_BROWSERS.find((d) => d.id === sourceId)
  return readChromiumCookies(profile.cookiesPath, def ? encryptionKeyFor(def) : null)
}

export function groupBySite(cookies: readonly ImportCookie[]): SiteGroup[] {
  const counts = new Map<string, number>()
  for (const c of cookies) {
    const site = siteOf(c.domain)
    if (site) counts.set(site, (counts.get(site) ?? 0) + 1)
  }
  return [...counts]
    .map(([site, count]) => {
      const excluded = excludedReason(site)
      return excluded ? { site, count, excluded } : { site, count }
    })
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
}

export function previewImport(sourceId: string, profileDir: string): ImportPreview {
  const { cookies, stats } = readSource(sourceId, profileDir)
  return { sites: groupBySite(cookies), stats }
}

export async function runImport(opts: { sourceId: string; profileDir: string; sites: string[]; targetProfileId: string; replace: boolean }): Promise<ImportSummary> {
  const wanted = new Set(opts.sites)
  const { cookies, stats } = readSource(opts.sourceId, opts.profileDir)
  let excluded = 0
  const selected = cookies.filter((c) => {
    const site = siteOf(c.domain)
    if (!site || !wanted.has(site)) return false
    if (excludedReason(site)) {
      excluded++
      return false
    }
    return true
  })
  const allowedSites = new Set([...wanted].filter((site) => !excludedReason(site)))
  const ses = session.fromPartition(partitionForProfile(opts.targetProfileId))
  const removed = opts.replace ? await clearSites(ses, allowedSites) : 0
  const { imported, failed } = await writeCookies(ses, selected)
  return {
    imported,
    failed,
    removed,
    skipped: { excluded, expired: stats.expired, partitioned: stats.partitioned, appBound: stats.appBound, undecryptable: stats.undecryptable },
    keyringUnavailable: stats.keyringUnavailable,
  }
}
