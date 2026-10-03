import { configStore } from '../config-store'
import { getMainWindow } from '../window'
import { getBrowserHost } from './browser-host'
import { executeBrowserTool, type ToolResult } from './browser-tool-exec'

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
  if (!configStore.get('rightPanelPrefs')?.browser) {
    result = { content: [{ type: 'text', text: 'browser_disabled: the user has not enabled the Browser panel (Settings → Right panels)' }], isError: true }
  } else {
    result = await executeBrowserTool(getBrowserHost(getMainWindow), {
      tool: String(data.tool ?? ''),
      args: data.args,
      sessionKey: slot.sessionFile || slot.poolKey,
      cwd: slot.cwd,
    })
  }
  post({ type: 'browser-tool-response', callId, result })
}
