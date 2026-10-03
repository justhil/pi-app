import { normalizeAddressInput, type BrowserTabInfo } from '@shared/browser-types'
import type { HistoryEntry } from './browser-history'

export type Suggestion =
  | { kind: 'open'; url: string }
  | { kind: 'search'; query: string; url: string }
  | { kind: 'tab'; tabId: string; url: string; title: string }
  | { kind: 'history'; url: string; title: string }

const stripScheme = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

function score(text: string, url: string, q: string): number {
  const u = stripScheme(url).toLowerCase()
  const t = text.toLowerCase()
  if (u.startsWith(q)) return 3
  if (u.split(/[./]/).some((part) => part.startsWith(q))) return 2
  if (u.includes(q) || t.includes(q)) return 1
  return 0
}

/**
 * Address bar suggestions. The first row always states exactly what Enter does — open this
 * address or search for this text — so input is never silently guessed into a wrong site.
 * Then matching open tabs (switch to them), then local history by match quality and recency.
 */
export function buildSuggestions(
  input: string,
  opts: { tabs: BrowserTabInfo[]; activeTabId: string | null; history: HistoryEntry[]; searchUrl: string; limit?: number },
): Suggestion[] {
  const query = input.trim()
  if (!query) return []
  const target = normalizeAddressInput(query, opts.searchUrl)
  const out: Suggestion[] = [target.startsWith(opts.searchUrl) ? { kind: 'search', query, url: target } : { kind: 'open', url: target }]
  const q = query.toLowerCase()
  const seen = new Set([target])
  const tabs = opts.tabs
    .filter((t) => t.tabId !== opts.activeTabId && t.url !== 'about:blank' && score(t.title, t.url, q) > 0)
    .slice(0, 3)
  for (const t of tabs) {
    seen.add(t.url)
    out.push({ kind: 'tab', tabId: t.tabId, url: t.url, title: t.title })
  }
  const ranked = opts.history
    .map((e) => ({ e, s: score(e.title, e.url, q) }))
    .filter((x) => x.s > 0 && !seen.has(x.e.url))
    .sort((a, b) => b.s - a.s || b.e.visits - a.e.visits || b.e.lastAt - a.e.lastAt)
  for (const { e } of ranked.slice(0, Math.max(0, (opts.limit ?? 7) - out.length))) out.push({ kind: 'history', url: e.url, title: e.title })
  return out
}
