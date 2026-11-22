import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isAllowedBrowserUrl, type BrowserBookmark } from '@shared/browser-types'

let storagePath = ''
let cache: BrowserBookmark[] | null = null

export function configureBookmarks(filePath: string): void {
  storagePath = filePath
  cache = null
}

function load(): BrowserBookmark[] {
  if (cache) return cache
  if (!storagePath || !existsSync(storagePath)) {
    cache = []
    return cache
  }
  try {
    const raw = JSON.parse(readFileSync(storagePath, 'utf-8'))
    if (Array.isArray(raw)) {
      cache = raw.filter(
        (b): b is BrowserBookmark =>
          !!b &&
          typeof b === 'object' &&
          typeof b.id === 'string' &&
          typeof b.url === 'string' &&
          isAllowedBrowserUrl(b.url),
      )
      return cache
    }
  } catch {
    /* corrupted file falls back to empty */
  }
  cache = []
  return cache
}

function save(items: BrowserBookmark[]): void {
  cache = items
  if (!storagePath) return
  try {
    mkdirSync(dirname(storagePath), { recursive: true })
    writeFileSync(storagePath, JSON.stringify(items, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[browser] failed to persist bookmarks:', (err as Error)?.message)
  }
}

export function listBookmarks(): BrowserBookmark[] {
  return [...load()]
}

export function addBookmark(input: {
  url: string
  title?: string
  folder?: string
  favicon?: string
}): BrowserBookmark[] {
  const url = input.url.trim()
  if (!isAllowedBrowserUrl(url) || url === 'about:blank') return listBookmarks()
  const items = load()
  const existingIdx = items.findIndex((b) => b.url === url)
  if (existingIdx >= 0) {
    const next = [...items]
    next[existingIdx] = {
      ...next[existingIdx],
      title: input.title?.trim() || next[existingIdx].title || url,
      folder: input.folder?.trim() ?? next[existingIdx].folder,
      ...(input.favicon ? { favicon: input.favicon } : {}),
    }
    save(next)
    return listBookmarks()
  }
  const bookmark: BrowserBookmark = {
    id: randomUUID(),
    title: input.title?.trim() || url.replace(/^https?:\/\//i, ''),
    url,
    folder: input.folder?.trim() || '',
    ...(input.favicon ? { favicon: input.favicon } : {}),
    createdAt: Date.now(),
  }
  save([...items, bookmark])
  return listBookmarks()
}

export function removeBookmark(idOrUrl: { id?: string; url?: string }): BrowserBookmark[] {
  const items = load()
  const next = items.filter((b) => {
    if (idOrUrl.id && b.id === idOrUrl.id) return false
    if (idOrUrl.url && b.url === idOrUrl.url) return false
    return true
  })
  if (next.length !== items.length) save(next)
  return listBookmarks()
}

export function updateBookmark(
  id: string,
  patch: { title?: string; url?: string; folder?: string },
): BrowserBookmark[] {
  const items = load()
  const idx = items.findIndex((b) => b.id === id)
  if (idx < 0) return listBookmarks()
  const nextUrl = patch.url?.trim() || items[idx].url
  if (!isAllowedBrowserUrl(nextUrl) || nextUrl === 'about:blank') return listBookmarks()
  const next = [...items]
  next[idx] = {
    ...next[idx],
    title: patch.title !== undefined ? patch.title.trim() || nextUrl : next[idx].title,
    url: nextUrl,
    folder: patch.folder !== undefined ? patch.folder.trim() : next[idx].folder,
  }
  save(next)
  return listBookmarks()
}

/** Parse Chrome/Edge/Firefox Netscape bookmark HTML export and merge deduplicated bookmarks. */
export function importHtmlBookmarks(html: string): { added: number; bookmarks: BrowserBookmark[] } {
  const existing = load()
  const seen = new Set(existing.map((b) => b.url))
  const addedItems: BrowserBookmark[] = []
  let currentFolder = ''
  const tokenRe = /<h3[^>]*>([^<]+)<\/h3>|<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[1]) {
      currentFolder = decodeHtmlEntities(match[1].trim()).slice(0, 60)
      continue
    }
    const url = decodeHtmlEntities((match[2] ?? '').trim())
    const title = decodeHtmlEntities((match[3] ?? '').trim()) || url.replace(/^https?:\/\//i, '')
    if (!url || url === 'about:blank' || !isAllowedBrowserUrl(url) || seen.has(url)) continue
    seen.add(url)
    addedItems.push({
      id: randomUUID(),
      title: title.slice(0, 140),
      url,
      folder: currentFolder,
      createdAt: Date.now(),
    })
    if (addedItems.length >= 500) break
  }
  if (addedItems.length > 0) save([...existing, ...addedItems])
  return { added: addedItems.length, bookmarks: listBookmarks() }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
