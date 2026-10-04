import type { CookiesSetDetails, Session } from 'electron'
import type { ImportCookie } from './read'
import { normalizeHost, siteOf } from './policy'

/** Electron's cookie details for an imported cookie, or null when it cannot be represented. */
export function toCookieDetails(c: ImportCookie): CookiesSetDetails | null {
  const host = normalizeHost(c.domain)
  if (!host) return null
  const hostOnly = !c.domain.startsWith('.')
  // __Host- cookies must be host-only, secure, path "/"; __Secure- must be secure.
  if (c.name.startsWith('__Host-') && (!hostOnly || !c.secure || c.path !== '/')) return null
  if (c.name.startsWith('__Secure-') && !c.secure) return null
  const path = c.path.startsWith('/') ? c.path : '/'
  return {
    url: `${c.secure ? 'https' : 'http'}://${host}${path}`,
    name: c.name,
    value: c.value,
    path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    // SameSite=None without Secure is rejected by Chromium; leave it to the default.
    sameSite: c.sameSite === 'no_restriction' && !c.secure ? 'unspecified' : c.sameSite,
    ...(hostOnly ? {} : { domain: `.${host}` }),
    ...(c.expires ? { expirationDate: c.expires } : {}),
  }
}

/** Remove the target profile's cookies for these sites (the "replace" option). */
export async function clearSites(ses: Session, sites: ReadonlySet<string>): Promise<number> {
  let removed = 0
  for (const c of await ses.cookies.get({})) {
    const site = c.domain ? siteOf(c.domain) : null
    if (!site || !sites.has(site)) continue
    const host = normalizeHost(c.domain ?? '')
    if (!host) continue
    await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`, c.name).catch(() => undefined)
    removed++
  }
  return removed
}

export async function writeCookies(ses: Session, cookies: readonly ImportCookie[]): Promise<{ imported: number; failed: number }> {
  let imported = 0
  let failed = 0
  for (const c of cookies) {
    const details = toCookieDetails(c)
    if (!details) {
      failed++
      continue
    }
    try {
      await ses.cookies.set(details)
      imported++
    } catch {
      // The reason may echo the value; count only.
      failed++
    }
  }
  await ses.cookies.flushStore().catch(() => undefined)
  return { imported, failed }
}
