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
import { addBookmark, configureBookmarks, importHtmlBookmarks, listBookmarks, removeBookmark, updateBookmark } from '../../browser/bookmarks'
import { detectLocalDevServers } from '../../browser/dev-servers'
import { listImportSources, previewImport, runImport } from '../../browser/cookie-import/service'
import { listLiveChromeCookieSites, syncLiveChromeCookies } from '../../browser/cookie-import/chrome-live-sync'
import { cancelAllInflightBrowserTools } from '../../browser/browser-tool-bridge'
import { browserDownloadDir } from '../../browser/electron-session'

function sdkAtLeast(version: string, min: [number, number, number]): boolean {
  const v = version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i]
  return true
}

const tabId = z.string().min(1).max(64)
const profileId = z.string().regex(/^[a-z0-9-]{1,48}$/)
const host = () => getBrowserHost(getMainWindow)

export function registerBrowserHandlers(): void {
  // Built-in Browser Stage is a first-class workspace capability (always available).
  configureCapabilities({
    browserPanelEnabled: () => true,
    chromeBridgeEnabled: () => chromeBridgeEnabled(),
    // tool_search arrived in pi 0.99; older runtimes get every browser tool declared.
    deferTools: () => sdkAtLeast(resolveActiveSdk(app.getPath('userData')).version, [0, 99, 0]),
  })

  configureSiteNotes(join(app.getPath('userData'), 'browser-site-notes'))
  configureBookmarks(join(app.getPath('userData'), 'browser-bookmarks.json'))
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
    const all = getChromeHost()?.listDetailed() ?? []
    const own = req.sessionFile ? all.filter((t) => t.sessionKey === req.sessionFile || t.sessionKey === 'shared') : []
    return {
      tabs: (own.length ? own : all).map((t) => ({
        tabId: t.tabId,
        title: t.title,
        url: t.url,
        borrowed: t.borrowed,
      })),
    }
  })
  registerHandler('ipc:browser.chrome.userTabs', async () => ({
    tabs: (await getChromeHost()?.userTabs().catch(() => [])) ?? [],
  }))
  registerHandlerWithSchema(
    'ipc:browser.chrome.borrowTab',
    z.object({ chromeTabId: z.number().int().positive(), sessionFile: z.string().max(4096).optional() }),
    async (req) => ({
      tab: (await getChromeHost()?.borrow(req.chromeTabId, req.sessionFile || 'shared')) ?? null,
    }),
  )
  registerHandlerWithSchema(
    'ipc:browser.chrome.returnTab',
    z.object({ tabId: z.string().min(1).max(64) }),
    async (req) => {
      await getChromeHost()?.giveBack(req.tabId)
      return { ok: true }
    },
  )
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
  registerHandler('ipc:browser.tabs.list', async () => peekBrowserHost()?.list() ?? { tabs: [], activeTabId: null })

  registerHandlerWithSchema(
    'ipc:browser.tabs.open',
    z.object({
      url: z.string().max(8192).optional(),
      profileId: profileId.optional(),
      sessionKey: z.string().max(4096).optional(),
      pinned: z.boolean().optional(),
    }),
    async (req) => ({ tab: host().openTab(req) }),
  )

  registerHandlerWithSchema('ipc:browser.tabs.close', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.closeTab(req.tabId)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.tabs.focus', z.object({ tabId: tabId.nullable(), sessionKey: z.string().max(4096).optional() }), async (req) => {
    peekBrowserHost()?.focusTab(req.tabId, req.sessionKey ? { sessionKey: req.sessionKey } : undefined)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.tabs.pin', z.object({ tabId, pinned: z.boolean() }), async (req) => ({
    tab: peekBrowserHost()?.pinTab(req.tabId, req.pinned) ?? null,
  }))

  registerHandlerWithSchema('ipc:browser.tabs.mute', z.object({ tabId, muted: z.boolean() }), async (req) => ({
    tab: peekBrowserHost()?.setMuted(req.tabId, req.muted) ?? null,
  }))

  registerHandlerWithSchema('ipc:browser.tabs.sleep', z.object({ tabId }), async (req) => ({
    tab: peekBrowserHost()?.sleepTab(req.tabId) ?? null,
  }))

  registerHandlerWithSchema('ipc:browser.tabs.duplicate', z.object({ tabId }), async (req) => ({
    tab: peekBrowserHost()?.duplicateTab(req.tabId) ?? null,
  }))

  registerHandlerWithSchema('ipc:browser.tabs.reorder', z.object({ order: z.array(tabId).max(200) }), async (req) => ({
    tabs: peekBrowserHost()?.reorderTabs(req.order) ?? [],
  }))

  registerHandler('ipc:browser.tabs.reopen', async () => ({
    tab: peekBrowserHost()?.reopenClosedTab() ?? null,
  }))

  registerHandler('ipc:browser.bookmarks.list', async () => ({ bookmarks: listBookmarks() }))
  registerHandlerWithSchema(
    'ipc:browser.bookmarks.add',
    z.object({
      url: z.string().min(1).max(8192),
      title: z.string().max(300).optional(),
      folder: z.string().max(120).optional(),
      favicon: z.string().max(4096).optional(),
    }),
    async (req) => ({ bookmarks: addBookmark(req) }),
  )
  registerHandlerWithSchema(
    'ipc:browser.bookmarks.remove',
    z.object({ id: z.string().max(64).optional(), url: z.string().max(8192).optional() }),
    async (req) => ({ bookmarks: removeBookmark(req) }),
  )
  registerHandlerWithSchema(
    'ipc:browser.bookmarks.update',
    z.object({
      id: z.string().min(1).max(64),
      title: z.string().max(300).optional(),
      url: z.string().max(8192).optional(),
      folder: z.string().max(120).optional(),
    }),
    async (req) => ({ bookmarks: updateBookmark(req.id, req) }),
  )
  registerHandlerWithSchema(
    'ipc:browser.bookmarks.importHtml',
    z.object({ html: z.string().max(2_000_000) }),
    async (req) => importHtmlBookmarks(req.html),
  )

  registerHandler('ipc:browser.cookies.sources', async () => ({ sources: listImportSources() }))
  registerHandlerWithSchema(
    'ipc:browser.cookies.preview',
    z.object({ sourceId: z.string().min(1).max(64), profileDir: z.string().min(1).max(256) }),
    async (req) => previewImport(req.sourceId, req.profileDir),
  )
  registerHandlerWithSchema(
    'ipc:browser.cookies.import',
    z.object({
      sourceId: z.string().min(1).max(64),
      profileDir: z.string().min(1).max(256),
      sites: z.array(z.string().max(253)).max(300),
      targetProfileId: profileId.optional(),
      replace: z.boolean().optional(),
    }),
    async (req) =>
      runImport({
        sourceId: req.sourceId,
        profileDir: req.profileDir,
        sites: req.sites,
        targetProfileId: req.targetProfileId ?? DEFAULT_ELECTRON_PROFILE_ID,
        replace: req.replace === true,
      }),
  )
  registerHandler('ipc:browser.cookies.chromeSites', async () => listLiveChromeCookieSites())
  registerHandlerWithSchema(
    'ipc:browser.cookies.chromeSync',
    z.object({
      sites: z.array(z.string().max(253)).max(200),
      targetProfileId: profileId.optional(),
      replace: z.boolean().optional(),
    }),
    async (req) => syncLiveChromeCookies(req),
  )

  registerHandler('ipc:browser.devServers', async () => ({ servers: await detectLocalDevServers() }))
  registerHandler('ipc:browser.downloads.openDir', async () => {
    await shell.openPath(browserDownloadDir())
    return { ok: true }
  })
  registerHandler('ipc:browser.agent.abort', async () => ({
    aborted: cancelAllInflightBrowserTools(),
  }))

  registerHandlerWithSchema(
    'ipc:browser.tabs.adoptSession',
    z.object({ fromSessionKey: z.string().max(4096), toSessionKey: z.string().max(4096) }),
    async (req) => {
      peekBrowserHost()?.adoptSessionTabs(req.fromSessionKey, req.toSessionKey)
      return { ok: true }
    },
  )

  registerHandlerWithSchema(
    'ipc:browser.session.set',
    z.object({ sessionKey: z.string().max(4096).nullable().optional() }),
    async (req) => peekBrowserHost()?.setSession(req.sessionKey ?? null) ?? { activeTabId: null },
  )

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

  registerHandlerWithSchema(
    'ipc:browser.inspectPoint',
    z.object({ ...point, deep: z.boolean().optional(), ancestorSteps: z.number().int().min(0).max(12).optional() }),
    async (req) => ({
      element: await host().inspectPoint(req.tabId, req.x, req.y, req.deep === true, req.ancestorSteps ?? 0),
    }),
  )

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
