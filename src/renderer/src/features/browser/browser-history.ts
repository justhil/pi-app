// Local visit history for address suggestions. Stays in this device's renderer storage: a
// convenience, never sent anywhere. Pages are recorded once they finish loading.

export interface HistoryEntry {
  url: string
  title: string
  visits: number
  lastAt: number
}

const KEY = 'pi-browser-history-v1'
const LIMIT = 400

export function recordVisit(list: HistoryEntry[], url: string, title: string, now = Date.now()): HistoryEntry[] {
  if (!/^https?:\/\//i.test(url)) return list
  const prev = list.find((e) => e.url === url)
  const entry: HistoryEntry = prev
    ? { ...prev, title: title || prev.title, visits: prev.visits + 1, lastAt: now }
    : { url, title, visits: 1, lastAt: now }
  return [entry, ...list.filter((e) => e.url !== url)].slice(0, LIMIT)
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : []
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.url === 'string') : []
  } catch {
    return []
  }
}

export function saveHistory(list: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage unavailable: suggestions just stay empty
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
