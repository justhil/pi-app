import { app, session, type Session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  browserAcceptLanguages,
  chromeUserAgent,
  withChromeClientHints,
  type BrowserEvent,
  type BrowserLogEntry,
} from '@shared/browser-types'
import { uniqueDownloadPath } from './download-path'
import { DownloadManager } from './downloads/download-manager'
import { configStore } from '../config-store'

let downloads: DownloadManager | null = null

/** One download manager for every browser profile; settings are read per download. */
export function getDownloadManager(emit?: (event: BrowserEvent) => void): DownloadManager {
  if (!downloads) {
    if (!emit) throw new Error('download manager not initialised')
    downloads = new DownloadManager(emit, () => ({
      downloader: configStore.get('browserDownloader') ?? 'auto',
      aria2Path: configStore.get('browserAria2Path') ?? '',
      connections: configStore.get('browserDownloadConnections') ?? 16,
    }))
  }
  return downloads
}

export function peekDownloadManager(): DownloadManager | null {
  return downloads
}

const configured = new Set<string>()

/** Requests in flight per page (webContents id) — what "the page is still working" means after an action. */
const inflight = new Map<number, Set<number>>()
const LONG_LIVED = new Set(['webSocket', 'media', 'ping', 'cspReport'])

export function pendingRequestCount(webContentsId: number): number {
  return inflight.get(webContentsId)?.size ?? 0
}

function settleRequest(details: { webContentsId?: number; id: number }): void {
  if (details.webContentsId == null) return
  const set = inflight.get(details.webContentsId)
  if (!set) return
  set.delete(details.id)
  if (set.size === 0) inflight.delete(details.webContentsId)
}

export function partitionForProfile(profileId: string): string {
  return `persist:pi-browser-${profileId}`
}

export function browserDownloadDir(): string {
  return join(app.getPath('downloads'), 'pi-browser')
}

/**
 * One-time setup of a built-in browser profile session: Chrome UA without Electron tokens,
 * Chrome-shaped Accept-Language and UA client-hint headers (header level only), permissions denied,
 * downloads into ~/Downloads/pi-browser. Nothing is injected into pages.
 */
export interface BrowserSessionHooks {
  emit: (event: BrowserEvent) => void
  /** Failed or >= 400 requests, routed to the tab that owns `webContentsId`. */
  onNetworkProblem: (webContentsId: number, entry: BrowserLogEntry) => void
}

export function configureBrowserSession(profileId: string, hooks: BrowserSessionHooks): Session {
  const { emit } = hooks
  const partition = partitionForProfile(profileId)
  const ses = session.fromPartition(partition)
  if (configured.has(partition)) return ses
  configured.add(partition)

  const chromeMajor = process.versions.chrome.split('.')[0]
  const languages = browserAcceptLanguages(app.getPreferredSystemLanguages())
  ses.setUserAgent(chromeUserAgent(chromeMajor, process.platform), languages.join(','))

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: withChromeClientHints(details.url, details.requestHeaders, chromeMajor, process.platform) })
  })

  ses.webRequest.onSendHeaders((details) => {
    if (details.webContentsId == null || LONG_LIVED.has(details.resourceType)) return
    let set = inflight.get(details.webContentsId)
    if (!set) inflight.set(details.webContentsId, (set = new Set()))
    set.add(details.id)
  })
  ses.webRequest.onCompleted((details) => {
    settleRequest(details)
    if (details.statusCode < 400 || details.webContentsId == null) return
    hooks.onNetworkProblem(details.webContentsId, {
      at: Date.now(),
      kind: 'network',
      level: details.statusCode >= 500 ? 'error' : 'warning',
      message: `${details.method} ${details.statusCode} ${details.url}`,
    })
  })
  ses.webRequest.onErrorOccurred((details) => {
    settleRequest(details)
    // Aborted requests are routine (navigation, cancelled fetches); keep real failures only.
    if (details.webContentsId == null || details.error === 'net::ERR_ABORTED') return
    hooks.onNetworkProblem(details.webContentsId, {
      at: Date.now(),
      kind: 'network',
      level: 'error',
      message: `${details.method} ${details.error} ${details.url}`,
    })
  })

  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  ses.on('will-download', (event, item, webContents) => {
    const dir = browserDownloadDir()
    let savePath: string
    try {
      mkdirSync(dir, { recursive: true })
      savePath = uniqueDownloadPath(dir, item.getFilename())
    } catch (error) {
      console.warn('[browser] download path unavailable:', error)
      item.cancel()
      return
    }
    getDownloadManager(emit).onWillDownload(event, ses, item, webContents, savePath)
  })
  return ses
}
