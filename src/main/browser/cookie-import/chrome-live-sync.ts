import { session } from 'electron'
import { DEFAULT_ELECTRON_PROFILE_ID } from '@shared/browser-types'
import { partitionForProfile } from '../electron-session'
import { getChromeBridge } from '../chrome'
import { excludedReason, siteOf } from './policy'
import { clearSites, writeCookies } from './write'
import type { ImportCookie } from './read'

export interface LiveChromeSiteGroup {
  site: string
  count: number
  excluded?: 'device-bound'
}

export async function listLiveChromeCookieSites(): Promise<{
  connected: boolean
  sites: LiveChromeSiteGroup[]
  error?: string
}> {
  const bridge = getChromeBridge()
  if (!bridge?.connected()) return { connected: false, sites: [] }
  try {
    const raw = await bridge.call<Array<{ site: string; count: number }>>('cookies.listSites', {}, 12_000)
    const sites: LiveChromeSiteGroup[] = (Array.isArray(raw) ? raw : []).map((row) => {
      const excluded = excludedReason(row.site)
      return excluded ? { site: row.site, count: row.count, excluded } : { site: row.site, count: row.count }
    })
    return { connected: true, sites }
  } catch (e) {
    return { connected: true, sites: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export async function syncLiveChromeCookies(opts: {
  sites: string[]
  targetProfileId?: string
  replace?: boolean
}): Promise<{ imported: number; failed: number; removed: number; excluded: number }> {
  const bridge = getChromeBridge()
  if (!bridge?.connected()) throw new Error('Chrome extension is not connected')
  const allowedSites = new Set(opts.sites.filter((s) => s && !excludedReason(s)))
  const excluded = opts.sites.length - allowedSites.size
  if (allowedSites.size === 0) return { imported: 0, failed: 0, removed: 0, excluded }

  const raw = await bridge.call<
    Array<{
      domain: string
      name: string
      value: string
      path: string
      secure: boolean
      httpOnly: boolean
      sameSite: 'no_restriction' | 'lax' | 'strict'
      expires?: number
    }>
  >('cookies.getForSites', { sites: [...allowedSites] }, 15_000)

  const cookies: ImportCookie[] = (Array.isArray(raw) ? raw : [])
    .filter((c) => {
      const site = siteOf(c.domain)
      return !!site && allowedSites.has(site) && !excludedReason(site)
    })
    .map((c) => ({
      domain: c.domain,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite === 'strict' ? 'strict' : c.sameSite === 'no_restriction' ? 'no_restriction' : 'lax',
      expires: typeof c.expires === 'number' ? c.expires : undefined,
    }))

  const ses = session.fromPartition(partitionForProfile(opts.targetProfileId || DEFAULT_ELECTRON_PROFILE_ID))
  const removed = opts.replace ? await clearSites(ses, allowedSites) : 0
  const { imported, failed } = await writeCookies(ses, cookies)
  return { imported, failed, removed, excluded }
}
