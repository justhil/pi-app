// Requests of one tab from CDP Network events, numbered so tool results can cite them (#41) and
// browser_devtools can show one later. BrowserSkill links actions to their requests;
// here act() reads the window [seq before, seq after].

export interface NetworkEntry {
  id: number
  requestId: string
  sessionId?: string
  method: string
  url: string
  type: string
  status?: number
  statusText?: string
  mime?: string
  failed?: string
  startedAt: number
  ms?: number
  size?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  postData?: string
  done: boolean
}

const MAX_ENTRIES = 300
/** What an action's "### Network" lists: the requests a page makes on purpose. */
const ACTION_TYPES = new Set(['Document', 'XHR', 'Fetch', 'EventSource'])
const LONG_LIVED = new Set(['WebSocket', 'EventSource', 'Media', 'Ping'])
const SECRET_HEADERS = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-auth-token|x-csrf-token)$/i

export class NetworkLog {
  private entries: NetworkEntry[] = []
  private byRequest = new Map<string, NetworkEntry>()
  private next = 1

  /** Number the next request will get: an action notes it before acting. */
  seq(): number {
    return this.next
  }

  onEvent(method: string, p: Record<string, any>, sessionId?: string): void {
    const key = `${sessionId ?? ''}:${p.requestId}`
    switch (method) {
      case 'Network.requestWillBeSent': {
        const prev = this.byRequest.get(key)
        if (prev && p.redirectResponse) {
          prev.status = p.redirectResponse.status
          prev.done = true
        }
        const e: NetworkEntry = {
          id: this.next++,
          requestId: p.requestId,
          sessionId,
          method: p.request?.method ?? 'GET',
          url: p.request?.url ?? '',
          type: p.type ?? 'Other',
          startedAt: Date.now(),
          requestHeaders: p.request?.headers,
          postData: typeof p.request?.postData === 'string' ? p.request.postData.slice(0, 4000) : undefined,
          done: false,
        }
        this.entries.push(e)
        this.byRequest.set(key, e)
        if (this.entries.length > MAX_ENTRIES) {
          const old = this.entries.shift()!
          this.byRequest.delete(`${old.sessionId ?? ''}:${old.requestId}`)
        }
        break
      }
      case 'Network.responseReceived': {
        const e = this.byRequest.get(key)
        if (!e) break
        e.status = p.response?.status
        e.statusText = p.response?.statusText
        e.mime = p.response?.mimeType
        e.responseHeaders = p.response?.headers
        if (p.type) e.type = p.type
        break
      }
      case 'Network.loadingFinished': {
        const e = this.byRequest.get(key)
        if (!e) break
        e.done = true
        e.ms = Date.now() - e.startedAt
        e.size = p.encodedDataLength
        break
      }
      case 'Network.loadingFailed': {
        const e = this.byRequest.get(key)
        if (!e) break
        e.done = true
        e.ms = Date.now() - e.startedAt
        e.failed = p.canceled ? 'canceled' : (p.blockedReason ?? p.errorText ?? 'failed')
        break
      }
    }
  }

  /** Requests still in flight (streams and media excluded; anything older than 30 s ignored). */
  pending(now = Date.now()): number {
    return this.entries.filter((e) => !e.done && !LONG_LIVED.has(e.type) && now - e.startedAt < 30_000).length
  }

  get(id: number): NetworkEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  /** Requests numbered >= `from` that an action report should mention. */
  since(from: number, max = 10): NetworkEntry[] {
    return this.entries.filter((e) => e.id >= from && ACTION_TYPES.has(e.type)).slice(0, max)
  }

  recent(max = 50, onlyFailed = false): NetworkEntry[] {
    return this.entries.filter((e) => !onlyFailed || e.failed || (e.status ?? 0) >= 400).slice(-max)
  }

  clear(): void {
    this.entries = []
    this.byRequest.clear()
  }
}

/** `#41 POST /api/login → 401 (182ms)`; same-origin URLs show only their path. */
export function formatEntry(e: NetworkEntry, origin?: string): string {
  let url = e.url
  try {
    const u = new URL(e.url)
    url = (origin && u.origin === origin ? '' : u.host) + u.pathname + (u.search.length > 1 ? (u.search.length > 60 ? '?…' : u.search) : '')
  } catch {
    /* keep raw */
  }
  const outcome = e.failed ? `✗ ${e.failed}` : e.status !== undefined ? `→ ${e.status}` : '… pending'
  return `#${e.id} ${e.method} ${url} ${outcome}${e.ms !== undefined ? ` (${e.ms}ms)` : ''}`
}

export function redactHeaders(h: Record<string, string> | undefined): string {
  if (!h) return '(none)'
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${SECRET_HEADERS.test(k) ? '[redacted]' : String(v).slice(0, 300)}`)
    .join('\n')
}
