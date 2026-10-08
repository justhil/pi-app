import { configStore } from '../config-store'
import { getMainWindow } from '../window'
import { getBrowserHost } from './browser-host'
import { executeBrowserTool, type AgentBrowserHost, type ToolResult } from './agent/tools'
import { chromeBridgeEnabled, getChromeHost } from './chrome'
import { browserTargetOf } from './targets'

/** Calls in flight, so a turn the user stopped also stops a help request or a download wait. */
const inflight = new Map<string, AbortController>()

const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** The browser this conversation drives: its "My Chrome" choice, else the built-in panel. */
function hostFor(slot: { sessionFile?: string | null; poolKey: string }): AgentBrowserHost | ToolResult {
  if (browserTargetOf(slot.sessionFile, slot.poolKey) === 'chrome') {
    if (!chromeBridgeEnabled()) return fail('browser_disabled: "My Chrome" is off (Settings → Browser)')
    const host = getChromeHost()
    return host ?? fail('browser_unsupported: the Chrome bridge is not running; turn My Chrome off and on in Settings → Browser')
  }
  if (!configStore.get('rightPanelPrefs')?.browser) return fail('browser_disabled: the user has not enabled the Browser panel (Settings → Right panels)')
  return getBrowserHost(getMainWindow)
}

/**
 * Worker → Main `browser-tool-request` (from the browser_* tools of a session that switched the
 * capability on). Replies with `browser-tool-response` carrying the same `callId`.
 */
export async function handleBrowserToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string; sessionFile?: string | null; poolKey: string },
  post: (message: Record<string, unknown>) => void,
): Promise<void> {
  const callId = String(data.callId ?? '')
  if (!callId) return
  let result: ToolResult
  const host = hostFor(slot)
  if ('content' in host) result = host
  else {
    const abort = new AbortController()
    inflight.set(callId, abort)
    try {
      result = await executeBrowserTool(host, {
        tool: String(data.tool ?? ''),
        args: data.args,
        sessionKey: slot.sessionFile || slot.poolKey,
        cwd: slot.cwd,
        signal: abort.signal,
      })
    } finally {
      inflight.delete(callId)
    }
  }
  post({ type: 'browser-tool-response', callId, result })
}

/** Worker → Main `browser-tool-cancel`: the turn was aborted or the worker gave up waiting. */
export function cancelBrowserToolRequest(callId: string): void {
  inflight.get(callId)?.abort()
}
