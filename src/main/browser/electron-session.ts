import { app, session, type Session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  browserAcceptLanguages,
  chromeUserAgent,
  withChromeClientHints,
  type BrowserEvent,
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
export function configureBrowserSession(profileId: string, emit: (event: BrowserEvent) => void): Session {
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
