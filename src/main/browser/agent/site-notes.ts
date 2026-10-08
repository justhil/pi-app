// Per-site notes the agent keeps for itself (GenericAgent's self-evolving SOP memory): a working
// selector, "this menu needs hover", "use world main for the date picker". Read back the first
// time a conversation reaches the site, so the next run does not rediscover them.

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserToolError } from './errors'

const MAX_FILE_BYTES = 8 * 1024
const MAX_NOTE_CHARS = 600

let dir: string | null = null

/** Main sets this to `<userData>/browser-site-notes` at startup. */
export function configureSiteNotes(path: string): void {
  dir = path
}

function notesDir(): string {
  if (!dir) throw new BrowserToolError('browser_unsupported', 'site notes are not available')
  return dir
}

/** `www.github.com` → `github.com`; null for non-web pages. */
export function hostKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

const fileOf = (host: string) => {
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) throw new BrowserToolError('browser_denied', `bad host ${host}`)
  return join(notesDir(), `${host}.md`)
}

export async function readSiteNotes(host: string): Promise<string> {
  try {
    return (await readFile(fileOf(host), 'utf8')).trim()
  } catch {
    return ''
  }
}

/** Append one dated note; the oldest notes go first when the file grows past 8 KB. */
export async function appendSiteNote(host: string, note: string, now = new Date()): Promise<string> {
  const text = note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS)
  if (!text) throw new BrowserToolError('browser_denied', 'the note is empty')
  const lines = (await readSiteNotes(host)).split('\n').filter(Boolean)
  lines.push(`- ${now.toISOString().slice(0, 10)}: ${text}`)
  while (lines.length > 1 && Buffer.byteLength(lines.join('\n')) > MAX_FILE_BYTES) lines.shift()
  await mkdir(notesDir(), { recursive: true })
  const body = lines.join('\n')
  await writeFile(fileOf(host), `${body}\n`)
  return body
}

export async function listSiteNotes(): Promise<{ host: string; bytes: number; updatedAt: number }[]> {
  const names = await readdir(notesDir()).catch(() => [] as string[])
  const out = await Promise.all(
    names
      .filter((n) => n.endsWith('.md'))
      .map(async (n) => {
        const s = await stat(join(notesDir(), n))
        return { host: n.slice(0, -3), bytes: s.size, updatedAt: s.mtimeMs }
      }),
  )
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteSiteNotes(host: string): Promise<void> {
  await rm(fileOf(host), { force: true })
}

/** Hosts whose notes a conversation has already been shown. */
const shown = new Map<string, Set<string>>()

/** `### Site notes` for a page, once per conversation and host (empty when none). */
export async function siteNotesSection(sessionKey: string, url: string): Promise<string> {
  const host = hostKey(url)
  if (!host || !dir) return ''
  const seen = shown.get(sessionKey) ?? new Set<string>()
  if (seen.has(host)) return ''
  seen.add(host)
  shown.set(sessionKey, seen)
  const notes = await readSiteNotes(host)
  return notes ? `### Site notes (${host}, written by earlier runs)\n${notes}` : ''
}
