// Which browser a conversation's browser_* tools drive: the built-in panel or the user's Chrome
// (capability "chrome"). Recorded when each message's capabilities are applied.

export type BrowserTarget = 'builtin' | 'chrome'

const bySession = new Map<string, BrowserTarget>()
let last: BrowserTarget = 'builtin'

export function noteBrowserTarget(sessionKey: string | undefined, capabilities: readonly string[] | undefined): void {
  if (!capabilities) return
  const target: BrowserTarget = capabilities.includes('chrome') ? 'chrome' : 'builtin'
  if (!capabilities.includes('chrome') && !capabilities.includes('browser')) return
  last = target
  if (sessionKey) bySession.set(sessionKey, target)
}

/** A draft's first message may run before its session file exists: fall back to the latest choice. */
export function browserTargetOf(...keys: (string | null | undefined)[]): BrowserTarget {
  for (const k of keys) if (k && bySession.has(k)) return bySession.get(k)!
  return last
}
