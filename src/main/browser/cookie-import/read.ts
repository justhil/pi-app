// Read a browser profile's cookies. The cookie store is copied (with its WAL) to a private
// temp dir first, so a running browser's lock does not matter; the copy is deleted at once.
// Values exist only in memory and are never logged.

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChromiumBrowserDef } from './browsers'
import { decryptCookieValue, isAppBound } from './decrypt'
import type { EncryptionKey } from './keys'

export interface ImportCookie {
  /** As stored: a leading dot marks a domain cookie, otherwise host-only. */
  domain: string
  name: string
  value: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  /** Seconds since the Unix epoch; undefined for session cookies. */
  expires?: number
}

export interface ReadStats {
  total: number
  expired: number
  partitioned: number
  appBound: number
  undecryptable: number
  keyringUnavailable: boolean
}

export interface ReadResult {
  cookies: ImportCookie[]
  stats: ReadStats
}

function withCopy<T>(source: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'pi-cookie-import-'))
  const copy = join(dir, 'cookies.db')
  try {
    copyFileSync(source, copy)
    for (const suffix of ['-wal', '-shm']) if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix)
    return fn(copy)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const CHROMIUM_EPOCH_OFFSET = 11644473600n

/** Chromium stores microseconds since 1601-01-01. */
export function chromiumTimeToUnix(raw: unknown): number | undefined {
  try {
    const t = BigInt(raw as bigint | number | string)
    if (t <= 0n) return undefined
    const secs = Number(t / 1000000n - CHROMIUM_EPOCH_OFFSET)
    return secs > 0 ? secs : undefined
  } catch {
    return undefined
  }
}

const chromiumSameSite = (raw: number): ImportCookie['sameSite'] => (raw === 1 ? 'no_restriction' : raw === 2 ? 'lax' : raw === 3 ? 'strict' : 'unspecified')
const firefoxSameSite = (raw: number): ImportCookie['sameSite'] => (raw === 0 ? 'no_restriction' : raw === 1 ? 'lax' : raw === 2 ? 'strict' : 'unspecified')

export function readChromiumCookies(cookiesPath: string, key: EncryptionKey | null, now = Date.now() / 1000): ReadResult {
  return withCopy(cookiesPath, (path) => {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      db.exec('PRAGMA query_only = 1')
      const columns = new Set((db.prepare('PRAGMA table_info(cookies)').all() as { name: string }[]).map((c) => c.name))
      const partition = columns.has('top_frame_site_key') ? ', top_frame_site_key' : ''
      const rows = db
        .prepare(`SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite${partition} FROM cookies`)
        .all() as Record<string, unknown>[]
      const stats: ReadStats = { total: rows.length, expired: 0, partitioned: 0, appBound: 0, undecryptable: 0, keyringUnavailable: key?.mode === 'aes-128-cbc' && !!key.keyringUnavailable }
      const cookies: ImportCookie[] = []
      for (const r of rows) {
        const expires = chromiumTimeToUnix(r.expires_utc)
        if (expires !== undefined && expires < now) {
          stats.expired++
          continue
        }
        // Partitioned (CHIPS) cookies belong to an embedding site; copying them flat would widen them.
        if (typeof r.top_frame_site_key === 'string' && r.top_frame_site_key) {
          stats.partitioned++
          continue
        }
        let value = typeof r.value === 'string' ? r.value : ''
        const encrypted = r.encrypted_value instanceof Uint8Array ? Buffer.from(r.encrypted_value) : Buffer.alloc(0)
        if (!value && encrypted.length) {
          if (isAppBound(encrypted)) {
            stats.appBound++
            continue
          }
          const plain = key ? decryptCookieValue(encrypted, key) : null
          if (!plain) {
            stats.undecryptable++
            continue
          }
          value = plain.toString('utf-8')
        }
        cookies.push({
          domain: String(r.host_key),
          name: String(r.name),
          value,
          path: String(r.path || '/'),
          secure: Number(r.is_secure) === 1,
          httpOnly: Number(r.is_httponly) === 1,
          sameSite: chromiumSameSite(Number(r.samesite)),
          expires,
        })
      }
      return { cookies, stats }
    } finally {
      db.close()
    }
  })
}

export function readFirefoxCookies(cookiesPath: string, now = Date.now() / 1000): ReadResult {
  return withCopy(cookiesPath, (path) => {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const columns = new Set((db.prepare('PRAGMA table_info(moz_cookies)').all() as { name: string }[]).map((c) => c.name))
      const partition = columns.has('originAttributes') ? ', originAttributes' : ''
      const rows = db.prepare(`SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite${partition} FROM moz_cookies`).all() as Record<string, unknown>[]
      const stats: ReadStats = { total: rows.length, expired: 0, partitioned: 0, appBound: 0, undecryptable: 0, keyringUnavailable: false }
      const cookies: ImportCookie[] = []
      for (const r of rows) {
        // Firefox stores expiry in seconds (newer builds in ms); treat huge values as ms.
        let expires = Number(r.expiry) || undefined
        if (expires && expires > 1e11) expires = Math.floor(expires / 1000)
        if (expires !== undefined && expires < now) {
          stats.expired++
          continue
        }
        if (typeof r.originAttributes === 'string' && r.originAttributes.includes('partitionKey')) {
          stats.partitioned++
          continue
        }
        cookies.push({
          domain: String(r.host),
          name: String(r.name),
          value: String(r.value ?? ''),
          path: String(r.path || '/'),
          secure: Number(r.isSecure) === 1,
          httpOnly: Number(r.isHttpOnly) === 1,
          sameSite: firefoxSameSite(Number(r.sameSite)),
          expires,
        })
      }
      return { cookies, stats }
    } finally {
      db.close()
    }
  })
}

export type { ChromiumBrowserDef }
