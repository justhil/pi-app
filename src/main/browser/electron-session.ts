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

const configured = new Set<string>()

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

  ses.webRequest.onCompleted((details) => {
    if (details.statusCode < 400 || details.webContentsId == null) return
    hooks.onNetworkProblem(details.webContentsId, {
      at: Date.now(),
      kind: 'network',
      level: details.statusCode >= 500 ? 'error' : 'warning',
      message: `${details.method} ${details.statusCode} ${details.url}`,
    })
  })
  ses.webRequest.onErrorOccurred((details) => {
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

  ses.on('will-download', (_event, item) => {
    const dir = browserDownloadDir()
    try {
      mkdirSync(dir, { recursive: true })
      item.setSavePath(uniqueDownloadPath(dir, item.getFilename()))
    } catch (error) {
      console.warn('[browser] download path unavailable:', error)
      item.cancel()
      return
    }
    item.once('done', (_e, state) => {
      emit({ type: 'download', fileName: item.getFilename(), savePath: item.getSavePath(), state })
    })
  })
  return ses
}
