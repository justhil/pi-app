import { join } from 'node:path'
import { app, session, shell } from 'electron'
import { z } from 'zod'
import { DEFAULT_ELECTRON_PROFILE_ID } from '@shared/browser-types'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { getMainWindow } from '../../window'
import { getBrowserHost, peekBrowserHost } from '../../browser/browser-host'
import { partitionForProfile, peekDownloadManager } from '../../browser/electron-session'
import { aria2Version, findAria2 } from '../../browser/downloads/download-manager'
import { configureCapabilities } from '../../capabilities/catalog'
import { configStore } from '../../config-store'
import { resolveActiveSdk } from '../../sdk-loader'
import { writeClipboardTempText } from '../../clipboard-temp-images'
import { openHelpRequests, respondHelp } from '../../browser/agent/help'
import { chromeBridgeEnabled, chromeBridgeStatus, extensionPath, getChromeHost, regenerateChromeToken, setChromeBridgeEnabled, startChromeBridge } from '../../browser/chrome'
import { configureSiteNotes, deleteSiteNotes, listSiteNotes, readSiteNotes } from '../../browser/agent/site-notes'

function sdkAtLeast(version: string, min: [number, number, number]): boolean {
  const v = version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i]
  return true
}

const tabId = z.string().min(1).max(64)
const profileId = z.string().regex(/^[a-z0-9-]{1,48}$/)
const host = () => getBrowserHost(getMainWindow)

export function registerBrowserHandlers(): void {
  // Browser control is only offered while the experimental Browser panel is switched on.
  configureCapabilities({
    browserPanelEnabled: () => !!configStore.get('rightPanelPrefs')?.browser,
    chromeBridgeEnabled: () => chromeBridgeEnabled(),
    // tool_search arrived in pi 0.99; older runtimes get every browser tool declared.
    deferTools: () => sdkAtLeast(resolveActiveSdk(app.getPath('userData')).version, [0, 99, 0]),
  })

  configureSiteNotes(join(app.getPath('userData'), 'browser-site-notes'))
  registerHandler('ipc:browser.siteNotes.list', async () => ({ sites: await listSiteNotes() }))
  const siteHost = z.string().regex(/^[a-z0-9.-]{1,253}$/)
  registerHandlerWithSchema('ipc:browser.siteNotes.read', z.object({ host: siteHost }), async (req) => ({ text: await readSiteNotes(req.host) }))
  registerHandlerWithSchema('ipc:browser.siteNotes.delete', z.object({ host: siteHost }), async (req) => {
    await deleteSiteNotes(req.host)
    return { sites: await listSiteNotes() }
  })
  void startChromeBridge().catch((error) => console.warn('[browser] Chrome bridge failed to start:', (error as Error)?.message))
  registerHandler('ipc:browser.chrome.status', async () => chromeBridgeStatus())
  registerHandlerWithSchema('ipc:browser.chrome.setEnabled', z.object({ enabled: z.boolean() }), async (req) => setChromeBridgeEnabled(req.enabled))
  registerHandlerWithSchema('ipc:browser.chrome.tabs', z.object({ sessionFile: z.string().max(4096).optional() }), async (req) => {
    const tabs = getChromeHost()?.list().tabs ?? []
    // Tabs of this conversation when it has any (a draft's tabs are keyed by its worker, so fall back to all).
    const own = req.sessionFile ? tabs.filter((t) => t.openedBy !== 'user' && t.openedBy.sessionKey === req.sessionFile) : []
    return { tabs: (own.length ? own : tabs).map((t) => ({ tabId: t.tabId, title: t.title, url: t.url })) }
  })
  registerHandlerWithSchema('ipc:browser.chrome.focusTab', z.object({ tabId: z.string().min(1).max(64) }), async (req) => {
    getChromeHost()?.focusTab(req.tabId, { window: true })
    return { ok: true }
  })
  registerHandler('ipc:browser.chrome.regenerate', async () => regenerateChromeToken())
  registerHandler('ipc:browser.chrome.openExtensionFolder', async () => ({ error: await shell.openPath(extensionPath()) }))
  registerHandler('ipc:browser.help.list', async () => ({ requests: openHelpRequests() }))
  registerHandlerWithSchema('ipc:browser.help.respond', z.object({ id: z.string().min(1).max(64), outcome: z.enum(['completed', 'cancelled']) }), async (req) => ({
    ok: respondHelp(req.id, req.outcome),
  }))
  registerHandler('ipc:browser.tabs.list',async () => peekBrowserHost()?.list() ?? { tabs: [], activeTabId: null })

  registerHandlerWithSchema(
    'ipc:browser.tabs.open',
    z.object({ url: z.string().max(8192).optional(), profileId: profileId.optional() }),
    async (req) => ({ tab: host().openTab(req) }),
  )

  registerHandlerWithSchema('ipc:browser.tabs.close', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.closeTab(req.tabId)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.tabs.focus', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.focusTab(req.tabId)
    return { ok: true }
  })

  registerHandlerWithSchema(
    'ipc:browser.navigate',
    z.union([
      z.object({ tabId, url: z.string().min(1).max(8192) }),
      z.object({ tabId, history: z.enum(['back', 'forward', 'reload', 'stop']) }),
    ]),
    async (req) => {
      const { tabId: id, ...op } = req
      await host().navigate(id, op)
      return { ok: true }
    },
  )

  registerHandlerWithSchema(
    'ipc:browser.viewBounds',
    z.object({
      tabId,
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
      visible: z.boolean(),
      pageZoom: z.number().finite().min(0.1).max(5).optional(),
    }),
    async (req) => {
      peekBrowserHost()?.setViewBounds(req)
      return { ok: true }
    },
  )

  registerHandler('ipc:browser.hideAll', async () => {
    peekBrowserHost()?.hideAll()
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.capture', z.object({ tabId }), async (req) => ({
    dataUrl: (await peekBrowserHost()?.capture(req.tabId)) ?? null,
  }))

  const point = { tabId, x: z.number().finite(), y: z.number().finite() }

  registerHandlerWithSchema('ipc:browser.inspectPoint', z.object({ ...point, deep: z.boolean().optional() }), async (req) => ({
    element: await host().inspectPoint(req.tabId, req.x, req.y, req.deep === true),
  }))

  registerHandlerWithSchema('ipc:browser.scroll', z.object({ ...point, deltaY: z.number().finite() }), async (req) => {
    host().scroll(req.tabId, req.x, req.y, req.deltaY)
    return { ok: true }
  })

  /** Find in page (Ctrl/⌘+F): results arrive as `find-result` events. */
  registerHandlerWithSchema('ipc:browser.find', z.object({ tabId, text: z.string().max(500), forward: z.boolean().optional(), findNext: z.boolean().optional() }), async (req) => {
    peekBrowserHost()?.find(req.tabId, req.text, { forward: req.forward ?? true, findNext: req.findNext ?? false })
    return { ok: true }
  })
  registerHandlerWithSchema('ipc:browser.find.stop', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.stopFind(req.tabId)
    return { ok: true }
  })

  registerHandler('ipc:browser.downloads.list', async () => ({ downloads: peekDownloadManager()?.list() ?? [] }))
  registerHandlerWithSchema('ipc:browser.downloads.cancel', z.object({ id: z.string().min(1).max(64) }), async (req) => {
    peekDownloadManager()?.cancel(req.id)
    return { ok: true }
  })
  registerHandlerWithSchema('ipc:browser.downloads.reveal', z.object({ id: z.string().min(1).max(64) }), async (req) => {
    peekDownloadManager()?.reveal(req.id)
    return { ok: true }
  })
  registerHandler('ipc:browser.downloads.clear', async () => {
    peekDownloadManager()?.clearFinished()
    return { downloads: peekDownloadManager()?.list() ?? [] }
  })
  /** Which aria2c would be used (configured path or PATH) and its version, for the settings page. */
  registerHandlerWithSchema('ipc:browser.downloader.status', z.object({ aria2Path: z.string().max(4096).optional() }), async (req) => {
    const path = findAria2(req.aria2Path ?? configStore.get('browserAria2Path') ?? '')
    return { path, version: path ? aria2Version(path) : null }
  })

  registerHandlerWithSchema('ipc:browser.logs', z.object({ tabId, max: z.number().int().min(1).max(200).optional() }), async (req) => ({
    entries: host().logs(req.tabId, req.max ?? 30),
  }))

  /** Page title/URL/selection plus the readable text saved as a .md attachment for the composer. */
  registerHandlerWithSchema('ipc:browser.pageContext', z.object({ tabId, saveText: z.boolean().optional() }), async (req) => {
    const ctx = await host().pageContext(req.tabId)
    if (!req.saveText) return { ...ctx, text: '', path: null }
    const header = `# ${ctx.title || ctx.url}\n\nSource: ${ctx.url}${ctx.truncated ? ' (truncated)' : ''}\n\n`
    const path = writeClipboardTempText(header + ctx.text, 'md')
    return { ...ctx, text: '', path }
  })

  registerHandler('ipc:browser.shutdown', async () => {
    peekBrowserHost()?.shutdown()
    return { ok: true }
  })

  registerHandlerWithSchema(
    'ipc:browser.profile.clear',
    z.object({ profileId: profileId.optional() }),
    async (req) => {
      const ses = session.fromPartition(partitionForProfile(req.profileId ?? DEFAULT_ELECTRON_PROFILE_ID))
      await ses.clearStorageData()
      await ses.clearCache()
      return { ok: true }
    },
  )
}
