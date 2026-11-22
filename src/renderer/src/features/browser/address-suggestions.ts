import { normalizeAddressInput, type BrowserBookmark, type BrowserTabInfo } from '@shared/browser-types'
import type { HistoryEntry } from './browser-history'

export type Suggestion =
  | { kind: 'open'; url: string }
  | { kind: 'search'; query: string; url: string }
  | { kind: 'tab'; tabId: string; url: string; title: string }
  | { kind: 'bookmark'; url: string; title: string }
  | { kind: 'devserver'; url: string; title: string }
  | { kind: 'history'; url: string; title: string }

const stripScheme = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

function score(text: string, url: string, q: string): number {
  const u = stripScheme(url).toLowerCase()
  const t = text.toLowerCase()
  if (u.startsWith(q)) return 3
  if (u.split(/[./:]/).some((part) => part.startsWith(q))) return 2
  if (u.includes(q) || t.includes(q)) return 1
  return 0
}

/**
 * Unified Omnibox suggestions:
 * 1. Explicit Enter action (open URL or search)
 * 2. Matching open tabs (jump directly)
 * 3. Saved bookmarks
 * 4. Running local DevServers (localhost:*)
 * 5. Local visit history by match quality and frequency
 */
export function buildSuggestions(
  input: string,
  opts: {
    tabs: BrowserTabInfo[]
    activeTabId: string | null
    bookmarks?: BrowserBookmark[]
    devServers?: Array<{ url: string; label: string }>
    history: HistoryEntry[]
    searchUrl: string
    limit?: number
  },
): Suggestion[] {
  const query = input.trim()
  if (!query) return []
  const target = normalizeAddressInput(query, opts.searchUrl)
  const out: Suggestion[] = [
    target.startsWith(opts.searchUrl) ? { kind: 'search', query, url: target } : { kind: 'open', url: target },
  ]
  const q = query.toLowerCase()
  const limit = opts.limit ?? 8
  const seen = new Set([target])

  const tabs = opts.tabs
    .filter((t) => t.tabId !== opts.activeTabId && t.url !== 'about:blank' && score(t.title, t.url, q) > 0)
    .slice(0, 3)
  for (const t of tabs) {
    seen.add(t.url)
    out.push({ kind: 'tab', tabId: t.tabId, url: t.url, title: t.title })
  }

  for (const b of opts.bookmarks ?? []) {
    if (out.length >= limit) break
    if (!seen.has(b.url) && score(b.title, b.url, q) > 0) {
      seen.add(b.url)
      out.push({ kind: 'bookmark', url: b.url, title: b.title })
    }
  }

  for (const s of opts.devServers ?? []) {
    if (out.length >= limit) break
    if (!seen.has(s.url) && score(s.label, s.url, q) > 0) {
      seen.add(s.url)
      out.push({ kind: 'devserver', url: s.url, title: s.label })
    }
  }

  const ranked = opts.history
    .map((e) => ({ e, s: score(e.title, e.url, q) }))
    .filter((x) => x.s > 0 && !seen.has(x.e.url))
    .sort((a, b) => b.s - a.s || b.e.visits - a.e.visits || b.e.lastAt - a.e.lastAt)
  for (const { e } of ranked.slice(0, Math.max(0, limit - out.length))) {
    out.push({ kind: 'history', url: e.url, title: e.title })
  }
  return out
}
