import { isIP } from 'node:net'

/**
 * Sites whose sessions are bound to the original device server-side: a copied cookie is
 * rejected or revoked within the hour, and importing it can sign the user out of the real
 * browser too. Never imported (and never cleared). From Orca's NON_TRANSPLANTABLE_DOMAINS.
 */
export const EXCLUDED_DOMAINS = ['google.com'] as const

/** Common two-level public suffixes — enough to group sites for a picker (not a security boundary). */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.hk', 'com.tw', 'org.tw',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr', 'com.au', 'net.au', 'org.au', 'edu.au', 'co.nz', 'com.br', 'com.mx',
  'co.in', 'co.id', 'com.sg', 'com.my', 'com.tr', 'com.ar', 'co.za', 'com.ua', 'github.io', 'gitlab.io', 'vercel.app',
  'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'appspot.com', 'blogspot.com', 'cloudfront.net', 'azurewebsites.net',
])

export function normalizeHost(domain: string): string | null {
  const host = domain.trim().replace(/^\.+/, '').toLowerCase()
  if (!host || /[/\\@?#%\s]/.test(host) || host.endsWith('.') || host.includes('..')) return null
  return host
}

/** Site a cookie belongs to for grouping (eTLD+1, approximately). */
export function siteOf(domain: string): string | null {
  const host = normalizeHost(domain)
  if (!host) return null
  if (isIP(host) || host === 'localhost') return host
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

export function excludedReason(site: string): 'device-bound' | null {
  return EXCLUDED_DOMAINS.some((root) => site === root || site.endsWith(`.${root}`)) ? 'device-bound' : null
}
